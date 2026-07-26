import Peer, { type DataConnection, type MediaConnection } from 'peerjs';

import { Store } from './Store';
import { brokerOptions } from '../lib/broker';
import { authProof, peerIdFor, seal, unseal } from '../lib/crypto';
import { buildLink } from '../lib/invite';
import { alarm } from '../lib/audio';
import { wakeLock } from '../lib/wakeLock';
import { STUN_SERVERS, trimSdp, waitForIceGathering, whenIceConnected } from '../lib/webrtc';
import { isControlMessage, type LinkHealth, type PairMode, type ReceiverSnapshot } from '../types';

const PING_TIMEOUT = 10_000;   // no heartbeat for this long means the link is dead
const CONNECT_TIMEOUT = 25_000;
const MAX_BACKOFF = 15_000;

const LOST_MESSAGE: Record<PairMode, string> = {
  passphrase: 'Signal lost — reconnecting…',
  link: 'Connection lost — ask for a new invite link',
};

const INITIAL: ReceiverSnapshot = {
  phase: 'idle',
  mode: 'passphrase',
  health: 'connecting',
  message: 'Connecting…',
  connectedAt: null,
  attempt: 0,
  replyLink: null,
  stream: null,
  error: null,
};

/**
 * The parent's phone: connects to the monitor and plays what it hears.
 *
 * Everything about staying connected lives here — the heartbeat watchdog, the audible alarm,
 * and the backoff redial. A baby monitor that quietly stops working is worse than one that
 * never started, so loss is always both visible and audible.
 */
export class ReceiverSession extends Store<ReceiverSnapshot> {
  private passphrase = '';
  private running = false;

  /** Bumped per dial attempt and on stop; handlers from superseded attempts check it. */
  private generation = 0;
  private lastPing = 0;

  // passphrase mode
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private call: MediaConnection | null = null;

  // link mode
  private pc: RTCPeerConnection | null = null;
  private pendingStream: MediaStream | null = null;
  private controlOpen = false;

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super(INITIAL);
  }

  /* ── passphrase mode ── */

  async startPassphrase(passphrase: string): Promise<void> {
    this.passphrase = passphrase;
    this.running = true;
    localStorage.setItem('bm:lastPass', passphrase);
    this.patch({
      ...INITIAL,
      phase: 'active',
      mode: 'passphrase',
      health: 'connecting',
      message: 'Connecting…',
    });
    void wakeLock.acquire();
    await this.dial();
  }

  private async dial(): Promise<void> {
    if (!this.running) return;
    const generation = ++this.generation;
    const stale = () => generation !== this.generation || !this.running;

    this.patch({ attempt: this.state.attempt + 1 });
    this.teardownConnection();

    const monitorId = await peerIdFor(this.passphrase);
    if (stale()) return;

    const peer = new Peer(brokerOptions());
    this.peer = peer;

    this.connectTimer = setTimeout(() => {
      if (!stale() && this.state.health !== 'live') {
        this.retry('Still trying to reach the monitor phone…', generation);
      }
    }, CONNECT_TIMEOUT);

    peer.on('open', () => {
      if (stale()) return;
      const conn = peer.connect(monitorId, { reliable: true });
      this.conn = conn;

      conn.on('data', (raw) => {
        void (async () => {
          if (stale() || !isControlMessage(raw)) return;
          switch (raw.t) {
            case 'challenge': {
              const proof = await authProof(this.passphrase, raw.nonce);
              if (!stale() && conn.open) conn.send({ t: 'auth', proof });
              break;
            }
            case 'denied':
              this.fail('The monitor phone rejected that passphrase. Check it matches exactly.');
              break;
            case 'ping':
              this.onHeartbeat();
              break;
            default:
              break;
          }
        })();
      });

      conn.on('close', () => this.retry('Connection dropped. Reconnecting…', generation));
      conn.on('error', () => this.retry('Connection error. Reconnecting…', generation));
    });

    peer.on('call', (call) => {
      if (stale()) return;
      this.call = call;
      call.answer(); // receive-only; we send nothing back
      call.on('stream', (stream) => {
        // The stream event fires before ICE is up, so wait for a real path first.
        whenIceConnected(call.peerConnection, () => {
          if (!stale()) this.attachStream(stream);
        });
      });
      call.on('close', () => this.retry('Audio stopped. Reconnecting…', generation));
    });

    peer.on('error', (err: Error & { type?: string }) => {
      if (stale()) return;
      if (err.type === 'peer-unavailable') {
        this.retry('No monitor phone is using that passphrase yet. Waiting…', generation);
      } else if (err.type === 'browser-incompatible') {
        this.fail('This browser does not support the connection this page needs.');
      } else {
        this.retry('Could not reach the pairing service. Retrying…', generation);
      }
    });
  }

  /* ── link mode ── */

  /** Throws when the passphrase does not open the invite, so the setup form can say so. */
  async startLink(inviteBlob: string, passphrase: string): Promise<void> {
    const payload = await unseal(inviteBlob, passphrase);
    if (payload.role !== 'offer') throw new Error('That is a reply link, not an invite.');

    this.passphrase = passphrase;
    this.running = true;
    localStorage.setItem('bm:lastPass', passphrase);
    this.patch({ ...INITIAL, phase: 'reply', mode: 'link' });

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.pc = pc;

    // Deliberately not gated on ICE. As the answerer, this side reaches
    // iceConnectionState 'connected' while the monitor is still sitting on have-local-offer,
    // because it can validate the checks arriving from candidates it learned in the offer. Going
    // live there would announce "Listening" before the monitor knows this phone exists, then
    // alarm seconds later. The monitor's control channel opening is the first thing that
    // genuinely proves the reply got through, since it takes a completed DTLS handshake.
    pc.ontrack = (e) => {
      this.pendingStream = e.streams[0];
      this.goLiveIfConfirmed();
    };

    pc.ondatachannel = (e) => {
      const channel = e.channel;
      channel.onmessage = (m) => {
        try {
          const parsed: unknown = JSON.parse(String(m.data));
          if (isControlMessage(parsed) && parsed.t === 'ping') this.onHeartbeat();
        } catch {
          // Not ours.
        }
      };
      const opened = () => {
        this.controlOpen = true;
        this.goLiveIfConfirmed();
      };
      if (channel.readyState === 'open') opened();
      else channel.onopen = opened;
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'failed' || state === 'closed') this.setHealth('lost', LOST_MESSAGE.link);
    };

    await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);
    if (!this.running || !pc.localDescription) return;

    const blob = await seal(
      { sid: payload.sid, role: 'answer', sdp: trimSdp(pc.localDescription.sdp) },
      passphrase,
    );
    this.patch({ replyLink: buildLink('r', blob) });
    void wakeLock.acquire();
  }

  /* ── shared ── */

  /** Link mode only: both the audio track and the monitor's confirmation have to be in hand. */
  private goLiveIfConfirmed(): void {
    if (this.controlOpen && this.pendingStream) this.attachStream(this.pendingStream);
  }

  private attachStream(stream: MediaStream): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;

    this.lastPing = Date.now();
    this.patch({
      phase: 'active',
      stream,
      attempt: 0,
      connectedAt: this.state.connectedAt ?? Date.now(),
    });
    this.setHealth('live', 'Listening');

    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = setInterval(() => this.checkAlive(), 1000);
  }

  private onHeartbeat(): void {
    this.lastPing = Date.now();
    if (this.state.health === 'lost') this.setHealth('live', 'Listening');
  }

  /** ICE can claim everything is fine long after audio has stopped; the heartbeat cannot. */
  private checkAlive(): void {
    if (!this.running || this.state.health !== 'live') return;
    if (Date.now() - this.lastPing <= PING_TIMEOUT) return;

    const mode = this.state.mode;
    this.setHealth('lost', LOST_MESSAGE[mode]);
    if (mode === 'passphrase') this.retry(LOST_MESSAGE.passphrase, this.generation);
  }

  private setHealth(health: LinkHealth, message: string): void {
    this.patch({ health, message });
    if (health === 'lost') alarm.start();
    else alarm.stop();
  }

  private retry(message: string, generation?: number): void {
    if (!this.running || this.state.mode !== 'passphrase') return;
    if (generation !== undefined && generation !== this.generation) return;
    if (this.retryTimer) return;

    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.setHealth(this.state.connectedAt ? 'lost' : 'connecting', message);

    const delay = Math.min(1000 * 2 ** Math.min(this.state.attempt, 4), MAX_BACKOFF);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.dial();
    }, delay);
  }

  private fail(message: string): void {
    this.running = false;
    this.generation++;
    this.teardownConnection();
    alarm.stop();
    wakeLock.release();
    this.patch({ phase: 'idle', stream: null, error: message });
  }

  private teardownConnection(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    try {
      this.call?.close();
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      // Already gone.
    }
    this.call = null;
    this.conn = null;
    this.peer = null;
  }

  clearError(): void {
    this.patch({ error: null });
  }

  stop(): void {
    this.running = false;
    this.generation++;

    if (this.watchTimer) clearInterval(this.watchTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.watchTimer = null;
    this.retryTimer = null;

    this.teardownConnection();
    try {
      this.pc?.close();
    } catch {
      // Already gone.
    }
    this.pc = null;
    this.pendingStream = null;
    this.controlOpen = false;

    alarm.stop();
    wakeLock.release();
    this.patch({ ...INITIAL });
  }

  /** Exposed for the end-to-end suite, which asserts on real RTP statistics. */
  activePeerConnection(): RTCPeerConnection | null {
    return this.pc ?? this.call?.peerConnection ?? null;
  }
}

export const receiver = new ReceiverSession();
