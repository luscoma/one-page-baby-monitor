import Peer, { type DataConnection, type MediaConnection } from 'peerjs';

import { Store } from './Store';
import { brokerOptions } from '../lib/broker';
import { authProof, peerIdFor, seal, unseal } from '../lib/crypto';
import { randomHex, timingSafeEqual } from '../lib/encoding';
import { HANDOFF_ACK, HANDOFF_ANSWER, handoffListen, handoffPost } from '../lib/handoff';
import { buildLink, extractBlob } from '../lib/invite';
import { getMicStream } from '../lib/audio';
import { wakeLock } from '../lib/wakeLock';
import { STUN_SERVERS, trimSdp, waitForIceGathering } from '../lib/webrtc';
import { isControlMessage, type ControlMessage, type MonitorSnapshot, type PairMode } from '../types';

const PING_INTERVAL = 3000;
const AUTH_TIMEOUT = 20_000;
const DIM_AFTER = 25_000;
const MAX_RECLAIM_ATTEMPTS = 8;

const WAKE_LOCK_NOTICE_PREFIX = 'This phone would not keep the screen on';

function noWakeLockNotice(reason: string): string {
  return `${WAKE_LOCK_NOTICE_PREFIX}${reason ? ` (${reason})` : ''}. Tap the screen to try again. `
    + 'If this stays up, set Auto-Lock to Never (iPhone: Settings → Display & Brightness) or the '
    + 'microphone will stop when the screen sleeps.';
}

interface ListenerSession {
  conn: DataConnection;
  call: MediaConnection | null;
  authed: boolean;
  authTimer: ReturnType<typeof setTimeout>;
}

const INITIAL: MonitorSnapshot = {
  phase: 'idle',
  mode: 'passphrase',
  passphrase: '',
  listeners: 0,
  startedAt: null,
  inviteLink: null,
  notice: '',
  dimmed: false,
};

/**
 * The baby's phone: captures the microphone and serves it to listeners.
 *
 * All transport lives here rather than in React. WebRTC and PeerJS are long-lived and
 * order-sensitive, and the generation guards below exist because tearing down a superseded
 * attempt fires that attempt's own handlers — which must not be allowed to cancel the attempt
 * replacing it.
 */
export class MonitorSession extends Store<MonitorSnapshot> {
  private passphrase = '';
  private stream: MediaStream | null = null;
  private running = false;

  /** Bumped on every registration attempt and on stop; stale events check it and bail. */
  private generation = 0;
  private brokerRetries = 0;

  // passphrase mode
  private peer: Peer | null = null;
  private sessions = new Map<string, ListenerSession>();

  // link mode
  private pc: RTCPeerConnection | null = null;
  private control: RTCDataChannel | null = null;
  private sid: string | null = null;
  private stopHandoff: (() => void) | null = null;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private dimTimer: ReturnType<typeof setTimeout> | null = null;
  private reclaimTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWakeWatch: (() => void) | null = null;

  constructor() {
    super(INITIAL);
  }

  /** Throws if the microphone is unavailable, so the setup form can show why. */
  async start(mode: PairMode, passphrase: string): Promise<void> {
    this.passphrase = passphrase;
    this.running = true;
    this.patch({ mode, passphrase, notice: '', inviteLink: null, listeners: 0 });

    // Take the lock now, inside the Start tap, not once a listener joins: the phone has to
    // stay awake through the waiting and invite screens too, or the mic dies before anyone hears it.
    void wakeLock.acquire();
    this.stream = await getMicStream();
    localStorage.setItem('bm:lastPass', passphrase);

    if (mode === 'passphrase') {
      this.patch({ phase: 'waiting' });
      this.brokerRetries = 0;
      await this.registerWithBroker();
    } else {
      this.patch({ phase: 'invite' });
      await this.startLinkMode();
    }
  }

  /* ── passphrase mode ── */

  private async registerWithBroker(): Promise<void> {
    if (!this.running) return;
    const generation = ++this.generation;
    const stale = () => generation !== this.generation || !this.running;

    const id = await peerIdFor(this.passphrase);
    if (stale()) return;

    const peer = new Peer(id, brokerOptions());
    this.peer = peer;

    peer.on('open', () => {
      if (stale()) return;
      this.brokerRetries = 0;
      this.patch({ notice: '' });
      this.goActive();
    });

    peer.on('connection', (conn) => {
      if (!stale()) this.onListenerConnect(conn);
    });

    peer.on('disconnected', () => {
      if (!stale() && !peer.destroyed) peer.reconnect();
    });

    peer.on('error', (err: Error & { type?: string }) => {
      if (stale()) return;
      switch (err.type) {
        case 'unavailable-id':
          // Nearly always this phone's own registration, which the broker has not expired yet.
          this.reclaimId();
          break;
        case 'network':
        case 'server-error':
        case 'socket-error':
          this.patch({
            notice: 'Lost contact with the pairing service. Anyone already listening keeps '
              + 'hearing you; new listeners cannot join until it is back.',
          });
          break;
        case 'browser-incompatible':
          this.patch({ notice: 'This browser does not support the connection this page needs.' });
          break;
        case 'peer-unavailable':
          break;
        default:
          this.patch({ notice: `Connection problem: ${err.type ?? err.message}` });
      }
    });
  }

  /**
   * A taken broker ID is almost always our own stale registration after a restart or a network
   * blip, and it clears within seconds. Keep trying before blaming the user's passphrase.
   */
  private reclaimId(): void {
    this.brokerRetries++;
    if (this.brokerRetries > MAX_RECLAIM_ATTEMPTS) {
      this.patch({
        notice: 'That passphrase is already in use by another monitor. Stop and pick a different one.',
      });
      return;
    }
    this.patch({ notice: 'Reclaiming your passphrase on the pairing service…' });
    if (this.reclaimTimer) clearTimeout(this.reclaimTimer);
    this.reclaimTimer = setTimeout(
      () => void this.registerWithBroker(),
      Math.min(2000 * this.brokerRetries, 8000),
    );
  }

  /**
   * Knowing the broker ID is not proof of knowing the passphrase — whoever runs the broker
   * knows every ID. Challenge each caller with a nonce and hand over the microphone only once
   * it answers correctly.
   */
  private onListenerConnect(conn: DataConnection): void {
    const nonce = randomHex(16);
    const session: ListenerSession = {
      conn,
      call: null,
      authed: false,
      authTimer: setTimeout(() => {
        if (!session.authed) conn.close();
      }, AUTH_TIMEOUT),
    };
    this.sessions.set(conn.peer, session);

    const send = (message: ControlMessage) => {
      try {
        conn.send(message);
      } catch {
        // Connection went away mid-handshake; the close handler cleans up.
      }
    };

    conn.on('open', () => send({ t: 'challenge', nonce }));

    conn.on('data', (raw) => {
      void (async () => {
        if (session.authed || !isControlMessage(raw) || raw.t !== 'auth') return;

        const expected = await authProof(this.passphrase, nonce);
        if (!timingSafeEqual(raw.proof, expected)) {
          send({ t: 'denied' });
          setTimeout(() => conn.close(), 250);
          return;
        }

        clearTimeout(session.authTimer);
        session.authed = true;
        send({ t: 'ok' });
        if (this.peer && this.stream) session.call = this.peer.call(conn.peer, this.stream);
        this.refreshListeners();
      })();
    });

    const drop = () => {
      clearTimeout(session.authTimer);
      session.call?.close();
      this.sessions.delete(conn.peer);
      this.refreshListeners();
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  /* ── link mode ── */

  private async startLinkMode(): Promise<void> {
    this.sid = randomHex(4);
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.pc = pc;
    this.stream?.getTracks().forEach((track) => pc.addTrack(track, this.stream!));

    this.control = pc.createDataChannel('ctl');
    this.control.onopen = () => this.goActive();

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') this.goActive();
      if (state === 'failed' || state === 'disconnected') this.refreshListeners();
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // No live signaling channel here, so every candidate must be in the SDP up front.
    await waitForIceGathering(pc);
    if (!this.running || !pc.localDescription) return;

    const blob = await seal(
      { sid: this.sid, role: 'offer', sdp: trimSdp(pc.localDescription.sdp) },
      this.passphrase,
    );
    this.patch({ inviteLink: buildLink('i', blob) });

    this.stopHandoff = handoffListen(HANDOFF_ANSWER, (fromTab) => {
      void this.acceptAnswer(fromTab, true);
    });
  }

  /**
   * Takes the reply, whether it arrived from the other tab automatically or was pasted by
   * hand. `quiet` suppresses errors for the automatic path, where a mismatched reply just
   * means this was not our handoff.
   */
  async acceptAnswer(text: string, quiet = false): Promise<void> {
    const pc = this.pc;
    if (!pc || pc.signalingState === 'stable') return;

    const blob = extractBlob(text);
    if (!blob) {
      if (!quiet) {
        this.patch({ notice: 'That does not look like a reply link. Copy the whole thing and try again.' });
      }
      return;
    }

    try {
      const payload = await unseal(blob, this.passphrase);
      if (payload.role !== 'answer') throw new Error('That is an invite link, not a reply.');
      if (payload.sid !== this.sid) {
        throw new Error('That reply belongs to a different invite. Share the current invite again.');
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      handoffPost(HANDOFF_ACK, this.sid);
      this.patch({ notice: '' });
    } catch (err) {
      if (!quiet) {
        this.patch({ notice: err instanceof Error ? err.message : 'Could not read that reply.' });
      }
    }
  }

  /* ── shared ── */

  private goActive(): void {
    if (!this.running || this.state.phase === 'active') return;

    this.patch({ phase: 'active', startedAt: Date.now(), notice: '', dimmed: false });

    this.stopWakeWatch?.();
    this.stopWakeWatch = wakeLock.onChange((held) => this.showWakeLockState(held));
    void wakeLock.acquire().then((held) => this.showWakeLockState(held));

    this.refreshListeners();
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL);
    this.scheduleDim();
  }

  /** Shows the wake-lock warning when a request fails and clears it once a retry succeeds. */
  private showWakeLockState(held: boolean): void {
    if (this.state.phase !== 'active') return;
    const showing = this.state.notice.startsWith(WAKE_LOCK_NOTICE_PREFIX);
    if (held) {
      if (showing) this.patch({ notice: '' });
    } else if (wakeLock.lastError || !wakeLock.supported) {
      // A plain release (page backgrounded) leaves lastError empty and is retaken on return.
      this.patch({ notice: noWakeLockNotice(wakeLock.lastError) });
    }
  }

  /**
   * A steady heartbeat is what lets the listener tell a quiet room from a dead connection.
   * Without it, silence looks identical either way.
   */
  private sendPing(): void {
    const message: ControlMessage = { t: 'ping', at: Date.now() };
    this.sessions.forEach((session) => {
      if (session.authed && session.conn.open) {
        try {
          session.conn.send(message);
        } catch {
          // Dropped mid-send; the close handler will clean up.
        }
      }
    });
    if (this.control?.readyState === 'open') {
      try {
        this.control.send(JSON.stringify(message));
      } catch {
        // Same.
      }
    }
  }

  private countListeners(): number {
    if (this.state.mode === 'passphrase') {
      let n = 0;
      this.sessions.forEach((session) => {
        if (session.authed) n++;
      });
      return n;
    }
    const state = this.pc?.iceConnectionState;
    return state === 'connected' || state === 'completed' ? 1 : 0;
  }

  private refreshListeners(): void {
    this.patch({ listeners: this.countListeners() });
  }

  /** Blanks the screen after a while so the phone can sit in a dark nursery all night. */
  private scheduleDim(): void {
    if (this.dimTimer) clearTimeout(this.dimTimer);
    this.dimTimer = setTimeout(() => this.patch({ dimmed: true }), DIM_AFTER);
  }

  /** Called when the user taps the dimmed overlay. */
  wakeUi(): void {
    this.patch({ dimmed: false });
    if (this.state.phase === 'active') this.scheduleDim();
  }

  stop(): void {
    this.running = false;
    this.generation++;

    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.dimTimer) clearTimeout(this.dimTimer);
    if (this.reclaimTimer) clearTimeout(this.reclaimTimer);
    this.pingTimer = this.dimTimer = this.reclaimTimer = null;

    this.stopHandoff?.();
    this.stopHandoff = null;

    this.sessions.forEach((session) => {
      clearTimeout(session.authTimer);
      try {
        session.call?.close();
        session.conn.close();
      } catch {
        // Already gone.
      }
    });
    this.sessions.clear();

    try {
      this.peer?.destroy();
      this.pc?.close();
    } catch {
      // Already gone.
    }
    this.peer = null;
    this.pc = null;
    this.control = null;
    this.sid = null;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.stopWakeWatch?.();
    this.stopWakeWatch = null;
    wakeLock.release();

    this.patch({ ...INITIAL, passphrase: this.state.passphrase, mode: this.state.mode });
  }

  /** Exposed for the end-to-end suite, which asserts on real RTP statistics. */
  activePeerConnections(): RTCPeerConnection[] {
    if (this.pc) return [this.pc];
    const found: RTCPeerConnection[] = [];
    this.sessions.forEach((session) => {
      if (session.call?.peerConnection) found.push(session.call.peerConnection);
    });
    return found;
  }
}

export const monitor = new MonitorSession();
