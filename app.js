/*
 * Baby Monitor — a two-phone audio monitor that runs entirely in the browser.
 *
 * Two ways to pair:
 *   Mode A "passphrase" — both phones derive the same PeerJS broker ID from a shared
 *     passphrase and find each other through the free PeerJS cloud broker.
 *   Mode B "link"       — the monitor mints an encrypted invite link that carries its SDP
 *     offer; the listener replies with a link carrying the answer. No broker involved.
 *
 * In both modes only the handshake is brokered. Audio is a direct DTLS-SRTP peer connection.
 */

/* ══════════════════════════ small utilities ══════════════════════════ */

const $ = (id) => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }];

const PING_INTERVAL = 3000;   // monitor -> listener heartbeat
const PING_TIMEOUT = 10000;   // listener declares the link dead after this long without one
const CONNECT_TIMEOUT = 25000;
const DIM_AFTER = 25000;

function show(viewId) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === viewId));
  window.scrollTo(0, 0);
}

function showPane(sectionId, paneId) {
  $(sectionId).querySelectorAll(':scope > .pane').forEach((p) => p.classList.toggle('hidden', p.id !== paneId));
}

function setBanner(el, message) {
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const PASS_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
function generatePassphrase() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += PASS_ALPHABET[bytes[i] % PASS_ALPHABET.length];
    if (i % 4 === 3 && i < 11) out += '-';
  }
  return out;
}

/** Passphrases are matched case- and whitespace-insensitively so both phones agree. */
function normalizePass(pass) {
  return pass.trim().toLowerCase().replace(/\s+/g, ' ');
}

function randomId(n = 8) {
  return hex(crypto.getRandomValues(new Uint8Array(n)));
}

/* ══════════════════════════ crypto ══════════════════════════ */

/**
 * Options for a PeerJS client. Defaults to the free PeerJS cloud broker; `?broker=host:port/path`
 * points at your own peerjs-server instead, which keeps the handshake off a third party too.
 */
function brokerOptions() {
  const base = { debug: 0, config: { iceServers: STUN } };
  const broker = new URLSearchParams(location.search).get('broker');
  if (!broker) return base;

  const parts = broker.match(/^([^:/]+)(?::(\d+))?(\/.*)?$/);
  if (!parts) return base;
  return {
    ...base,
    host: parts[1],
    port: parts[2] ? Number(parts[2]) : (location.protocol === 'https:' ? 443 : 80),
    path: parts[3] || '/',
    secure: location.protocol === 'https:',
  };
}

async function pbkdf2Bits(pass, salt, iterations, bits) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    bits,
  );
  return new Uint8Array(derived);
}

/**
 * The broker ID is a slow hash of the passphrase. Anyone watching the broker sees the ID but
 * recovering the passphrase from it costs a full PBKDF2 run per guess.
 */
async function peerIdFor(pass) {
  const bits = await pbkdf2Bits(normalizePass(pass), enc.encode('baby-monitor/peer-id/v1'), 100000, 160);
  return 'bm' + hex(bits);
}

/**
 * Knowing the broker ID is not proof of knowing the passphrase, so the monitor challenges
 * every caller before it hands over the microphone.
 */
async function authProof(pass, nonce) {
  const bits = await pbkdf2Bits(normalizePass(pass), enc.encode('baby-monitor/auth/v1|' + nonce), 60000, 256);
  return hex(bits);
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const SEAL_VERSION = 1;

/** Packs an object into a URL-safe blob encrypted with a key derived from the passphrase. */
async function seal(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify(obj));
  const squeezed = await deflateRaw(plain);
  const body = squeezed || plain;

  const keyBits = await pbkdf2Bits(normalizePass(pass), salt, 150000, 256);
  const key = await crypto.subtle.importKey('raw', keyBits, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));

  const out = new Uint8Array(30 + ct.length);
  out[0] = SEAL_VERSION;
  out[1] = squeezed ? 1 : 0;
  out.set(salt, 2);
  out.set(iv, 18);
  out.set(ct, 30);
  return b64urlEncode(out);
}

async function unseal(blob, pass) {
  const raw = b64urlDecode(blob);
  if (raw.length < 31 || raw[0] !== SEAL_VERSION) throw new Error('This link is not in a format this page understands.');

  const compressed = raw[1] === 1;
  const salt = raw.slice(2, 18);
  const iv = raw.slice(18, 30);
  const ct = raw.slice(30);

  const keyBits = await pbkdf2Bits(normalizePass(pass), salt, 150000, 256);
  const key = await crypto.subtle.importKey('raw', keyBits, 'AES-GCM', false, ['decrypt']);

  let body;
  try {
    body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  } catch {
    throw new Error('Wrong passphrase for this link.');
  }
  if (compressed) body = await inflateRaw(body);
  return JSON.parse(dec.decode(body));
}

/* ══════════════════════════ platform helpers ══════════════════════════ */

const wakeLock = {
  sentinel: null,
  wanted: false,
  supported: 'wakeLock' in navigator,

  async acquire() {
    this.wanted = true;
    if (!this.supported) return false;
    if (this.sentinel && !this.sentinel.released) return true;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => { this.sentinel = null; });
      return true;
    } catch {
      this.sentinel = null;
      return false;
    }
  },

  release() {
    this.wanted = false;
    if (this.sentinel) {
      this.sentinel.release().catch(() => {});
      this.sentinel = null;
    }
  },
};

// iOS drops the wake lock whenever the page is backgrounded; take it back on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock.wanted) wakeLock.acquire();
});

let audioCtx = null;
/** Must be called from inside a user gesture; iOS will not start audio otherwise. */
function unlockAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

const alarm = {
  timer: null,
  start() {
    if (this.timer || !audioCtx) return;
    const beep = () => {
      if (!audioCtx) return;
      [0, 0.35].forEach((offset, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = i === 0 ? 880 : 660;
        const t = audioCtx.currentTime + offset;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    };
    beep();
    this.timer = setInterval(beep, 2500);
  },
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  },
};

/**
 * Noise suppression and echo cancellation are tuned for speech on a call — they treat a
 * sleeping baby's breathing and whimpering as noise to remove. Turn them off.
 */
async function getMicStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('This browser cannot access the microphone. Try Safari or Chrome.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
  } catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      throw new Error('Microphone access was blocked. Allow it in your browser settings and try again.');
    }
    if (err && err.name === 'NotFoundError') throw new Error('No microphone found on this phone.');
    throw new Error('Could not start the microphone: ' + (err && err.message ? err.message : err));
  }
}

async function shareOrCopy(text, label) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    window.prompt(`Copy the ${label}:`, text);
    return 'prompted';
  }
}

function flashButton(btn, text) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = btn.dataset.label; }, 1600);
}

/* ══════════════════════════ raw WebRTC helpers (mode B) ══════════════════════════ */

/**
 * Mode B has no live signaling channel, so every candidate has to be in the SDP before we
 * can build the link. TCP candidates are dropped — on a home Wi-Fi the UDP host candidates
 * are what actually connect, and every line we drop shortens the link.
 */
function waitForIceGathering(pc, timeoutMs = 6000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * `ontrack` / PeerJS `stream` fire as soon as the remote description lands, long before any
 * audio can flow, so treat the ICE state as the real signal that we are connected.
 */
function whenIceConnected(pc, onConnected) {
  const check = () => {
    const state = pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') {
      pc.removeEventListener('iceconnectionstatechange', check);
      onConnected();
    }
  };
  pc.addEventListener('iceconnectionstatechange', check);
  check();
}

function trimSdp(sdp) {
  return sdp
    .split('\r\n')
    .filter((line) => !(line.startsWith('a=candidate:') && / tcp /i.test(line)))
    .join('\r\n');
}

/** Pulls the sealed blob out of whatever the user pasted — a full link or a bare code. */
function extractBlob(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/[#&][ir]=([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{40,}$/.test(trimmed) ? trimmed : null;
}

function buildLink(kind, blob) {
  return `${location.origin}${location.pathname}#${kind}=${blob}`;
}

/* ══════════════════════════ cross-tab handoff (mode B return trip) ══════════════════════════ */

const HANDOFF_ANSWER = 'bm:answer';
const HANDOFF_ACK = 'bm:ack';
const handoffChannel = 'BroadcastChannel' in window ? new BroadcastChannel('bm-signal') : null;

function handoffPost(key, value) {
  const payload = JSON.stringify({ key, value, at: Date.now() });
  try { localStorage.setItem(key, payload); } catch {}
  if (handoffChannel) handoffChannel.postMessage({ key, value });
}

function handoffListen(key, onValue) {
  const fromStorage = (e) => {
    if (e.key !== key || !e.newValue) return;
    try { onValue(JSON.parse(e.newValue).value); } catch {}
  };
  const fromChannel = (e) => {
    if (e.data && e.data.key === key) onValue(e.data.value);
  };
  window.addEventListener('storage', fromStorage);
  if (handoffChannel) handoffChannel.addEventListener('message', fromChannel);
  return () => {
    window.removeEventListener('storage', fromStorage);
    if (handoffChannel) handoffChannel.removeEventListener('message', fromChannel);
  };
}

/* ══════════════════════════ monitor ══════════════════════════ */

const monitor = {
  mode: 'passphrase',
  pass: '',
  stream: null,
  peer: null,
  sessions: new Map(),   // peerId -> { conn, call, authed }
  pc: null,              // mode B
  ctlChannel: null,      // mode B
  sid: null,
  startedAt: 0,
  tickTimer: null,
  pingTimer: null,
  dimTimer: null,
  reclaimTimer: null,
  stopHandoff: null,
  running: false,
  gen: 0,
  brokerRetries: 0,

  async start(mode, pass) {
    this.mode = mode;
    this.pass = pass;
    this.running = true;
    this.stream = await getMicStream();
    localStorage.setItem('bm:lastPass', pass);
    if (mode === 'passphrase') await this.startPassphraseMode();
    else await this.startLinkMode();
  },

  /* ── mode A ── */
  async startPassphraseMode() {
    showPane('view-monitor', 'monWaitPass');
    $('monPassEcho').textContent = this.pass;
    setBanner($('monWaitErr'), '');
    this.brokerRetries = 0;
    await this.registerWithBroker();
  },

  /** Errors belong to whichever screen the user is looking at. */
  note(message) {
    const active = !$('monActive').classList.contains('hidden');
    setBanner($(active ? 'monWakeWarn' : 'monWaitErr'), message);
  },

  async registerWithBroker() {
    if (!this.running) return;
    const gen = ++this.gen;
    const stale = () => gen !== this.gen || !this.running;

    const id = await peerIdFor(this.pass);
    if (stale()) return;

    const peer = new Peer(id, brokerOptions());
    this.peer = peer;

    peer.on('open', () => {
      if (stale()) return;
      this.brokerRetries = 0;
      this.note('');
      this.goActive();
    });

    peer.on('connection', (conn) => { if (!stale()) this.onListenerConnect(conn); });

    peer.on('disconnected', () => {
      if (!stale() && !peer.destroyed) peer.reconnect();
    });

    peer.on('error', (err) => {
      if (stale()) return;
      if (err.type === 'unavailable-id') {
        // Usually our own registration from a moment ago that the broker has not expired yet.
        this.reclaimId();
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        this.note('Lost contact with the pairing service. Anyone already listening keeps hearing you; new listeners cannot join until it is back.');
      } else if (err.type === 'browser-incompatible') {
        this.note('This browser does not support the connection this page needs.');
      } else if (err.type !== 'peer-unavailable') {
        this.note('Connection problem: ' + err.type);
      }
    });
  },

  /**
   * A taken ID is nearly always this phone's own stale registration after a restart or a
   * network blip, and it clears within a few seconds. Keep trying before blaming the user.
   */
  reclaimId() {
    this.brokerRetries++;
    if (this.brokerRetries > 8) {
      this.note('That passphrase is already in use by another monitor. Stop and pick a different one.');
      return;
    }
    this.note('Reclaiming your passphrase on the pairing service…');
    clearTimeout(this.reclaimTimer);
    this.reclaimTimer = setTimeout(() => this.registerWithBroker(), Math.min(2000 * this.brokerRetries, 8000));
  },

  onListenerConnect(conn) {
    const nonce = randomId(16);
    const session = { conn, call: null, authed: false, nonce };
    this.sessions.set(conn.peer, session);

    const timeout = setTimeout(() => {
      if (!session.authed) conn.close();
    }, 20000);

    conn.on('open', () => conn.send({ t: 'challenge', nonce }));

    conn.on('data', async (msg) => {
      if (!msg || session.authed) return;
      if (msg.t !== 'auth') return;

      const expected = await authProof(this.pass, nonce);
      if (!timingSafeEqual(String(msg.proof || ''), expected)) {
        conn.send({ t: 'denied' });
        setTimeout(() => conn.close(), 250);
        return;
      }

      clearTimeout(timeout);
      session.authed = true;
      conn.send({ t: 'ok' });
      session.call = this.peer.call(conn.peer, this.stream);
      this.updateListeners();
    });

    const drop = () => {
      clearTimeout(timeout);
      if (session.call) session.call.close();
      this.sessions.delete(conn.peer);
      this.updateListeners();
    };
    conn.on('close', drop);
    conn.on('error', drop);
  },

  /* ── mode B ── */
  async startLinkMode() {
    showPane('view-monitor', 'monWaitLink');
    setBanner($('monLinkErr'), '');
    $('monInviteText').value = 'Building invite…';

    this.sid = randomId(4);
    this.pc = new RTCPeerConnection({ iceServers: STUN });
    this.stream.getTracks().forEach((track) => this.pc.addTrack(track, this.stream));

    this.ctlChannel = this.pc.createDataChannel('ctl');
    this.ctlChannel.onopen = () => this.goActive();

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') this.goActive();
      if (state === 'failed' || state === 'disconnected') this.updateListeners();
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceGathering(this.pc);
    if (!this.running) return;

    const blob = await seal({ sid: this.sid, role: 'offer', sdp: trimSdp(this.pc.localDescription.sdp) }, this.pass);
    const link = buildLink('i', blob);
    $('monInviteText').value = link;
    this.inviteLink = link;

    this.stopHandoff = handoffListen(HANDOFF_ANSWER, (blobFromTab) => this.acceptAnswer(blobFromTab, true));
  },

  async acceptAnswer(blobOrText, quiet = false) {
    if (!this.pc || this.pc.signalingState === 'stable') return;
    const blob = extractBlob(blobOrText);
    if (!blob) {
      if (!quiet) setBanner($('monLinkErr'), 'That does not look like a reply link. Copy the whole thing and try again.');
      return;
    }
    try {
      const payload = await unseal(blob, this.pass);
      if (payload.role !== 'answer') throw new Error('That is an invite link, not a reply.');
      if (payload.sid !== this.sid) throw new Error('That reply belongs to a different invite. Share the current invite again.');
      await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      handoffPost(HANDOFF_ACK, this.sid);
      setBanner($('monLinkErr'), '');
    } catch (err) {
      if (!quiet) setBanner($('monLinkErr'), err.message || 'Could not read that reply.');
    }
  },

  /* ── shared ── */
  goActive() {
    if (!this.running || !$('monActive').classList.contains('hidden')) return;

    showPane('view-monitor', 'monActive');
    this.startedAt = Date.now();
    setBanner($('monWakeWarn'), '');

    wakeLock.acquire().then((ok) => {
      if (!ok) {
        setBanner($('monWakeWarn'),
          'This browser will not keep the screen on by itself. Set Auto-Lock to Never (iPhone: Settings → Display & Brightness) or the microphone will stop when the screen sleeps.');
      }
    });

    this.updateListeners();
    this.tick();
    this.tickTimer = setInterval(() => this.tick(), 1000);

    if (this.mode === 'passphrase' || this.ctlChannel) {
      this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL);
    }
    this.scheduleDim();
  },

  sendPing() {
    const msg = { t: 'ping', at: Date.now() };
    this.sessions.forEach((s) => {
      if (s.authed && s.conn.open) {
        try { s.conn.send(msg); } catch {}
      }
    });
    if (this.ctlChannel && this.ctlChannel.readyState === 'open') {
      try { this.ctlChannel.send(JSON.stringify(msg)); } catch {}
    }
  },

  listenerCount() {
    if (this.mode === 'passphrase') {
      let n = 0;
      this.sessions.forEach((s) => { if (s.authed) n++; });
      return n;
    }
    const state = this.pc ? this.pc.iceConnectionState : '';
    return state === 'connected' || state === 'completed' ? 1 : 0;
  },

  updateListeners() {
    const n = this.listenerCount();
    const label = n === 0 ? 'No one listening yet' : n === 1 ? '1 phone listening' : `${n} phones listening`;
    $('monListeners').textContent = label;
    $('monDot').className = 'dot ' + (n > 0 ? 'is-live' : 'is-wait');
    $('monDimDot').className = 'dot ' + (n > 0 ? 'is-live' : 'is-wait');
    $('monStatus').textContent = n > 0 ? 'Streaming' : 'Ready';
    $('monDimStatus').textContent = n > 0 ? 'Streaming' : 'Waiting for a listener';
  },

  tick() {
    $('monSince').textContent = 'Microphone on for ' + fmtDuration(Date.now() - this.startedAt);
  },

  scheduleDim() {
    clearTimeout(this.dimTimer);
    this.dimTimer = setTimeout(() => $('monDim').classList.remove('hidden'), DIM_AFTER);
  },

  stop() {
    this.running = false;
    this.gen++;
    clearInterval(this.tickTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.dimTimer);
    clearTimeout(this.reclaimTimer);
    if (this.stopHandoff) this.stopHandoff();
    this.stopHandoff = null;

    this.sessions.forEach((s) => {
      try { if (s.call) s.call.close(); } catch {}
      try { s.conn.close(); } catch {}
    });
    this.sessions.clear();

    if (this.peer) { try { this.peer.destroy(); } catch {} this.peer = null; }
    if (this.pc) { try { this.pc.close(); } catch {} this.pc = null; }
    this.ctlChannel = null;

    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    wakeLock.release();

    $('monDim').classList.add('hidden');
    showPane('view-monitor', 'monSetup');
    show('view-landing');
  },
};

/* ══════════════════════════ receiver ══════════════════════════ */

const receiver = {
  mode: 'passphrase',
  pass: '',
  peer: null,
  conn: null,
  call: null,
  pc: null,          // mode B
  sid: null,
  running: false,
  connectedAt: 0,
  lastPing: 0,
  attempt: 0,
  gen: 0,
  retryTimer: null,
  tickTimer: null,
  watchTimer: null,
  connectTimer: null,
  state: 'connecting',

  async start(mode, pass, inviteBlob) {
    this.mode = mode;
    this.pass = pass;
    this.running = true;
    this.attempt = 0;
    unlockAudio();
    localStorage.setItem('bm:lastPass', pass);

    if (mode === 'passphrase') {
      show('view-receiver');
      showPane('view-receiver', 'recActive');
      this.setState('connecting', 'Connecting…');
      wakeLock.acquire();
      this.tickTimer = setInterval(() => this.tick(), 1000);
      await this.dial();
    } else {
      await this.startLinkMode(inviteBlob);
    }
  },

  /* ── mode A ── */
  /**
   * Every attempt carries a generation number. Tearing down the previous peer fires its own
   * close/error handlers, and without this guard those stale events would schedule a redial
   * that kills the connection currently being set up.
   */
  async dial() {
    if (!this.running) return;
    const gen = ++this.gen;
    this.attempt++;
    this.teardownConnection();
    const stale = () => gen !== this.gen || !this.running;

    const monitorId = await peerIdFor(this.pass);
    if (stale()) return;

    const peer = new Peer(undefined, brokerOptions());
    this.peer = peer;

    this.connectTimer = setTimeout(() => {
      if (!stale() && this.state !== 'live') this.retry('Still trying to reach the monitor phone…', gen);
    }, CONNECT_TIMEOUT);

    peer.on('open', () => {
      if (stale()) return;
      const conn = peer.connect(monitorId, { reliable: true });
      this.conn = conn;

      conn.on('data', async (msg) => {
        if (stale() || !msg) return;
        if (msg.t === 'challenge') {
          const proof = await authProof(this.pass, msg.nonce);
          if (!stale() && conn.open) conn.send({ t: 'auth', proof });
        } else if (msg.t === 'denied') {
          this.fail('The monitor phone rejected that passphrase. Check it matches exactly.');
        } else if (msg.t === 'ping') {
          this.lastPing = Date.now();
          if (this.state === 'lost') this.setState('live', 'Listening');
        }
      });

      conn.on('close', () => this.retry('Connection dropped. Reconnecting…', gen));
      conn.on('error', () => this.retry('Connection error. Reconnecting…', gen));
    });

    peer.on('call', (call) => {
      if (stale()) return;
      this.call = call;
      call.answer();   // receive-only: we send nothing back
      call.on('stream', (stream) => {
        whenIceConnected(call.peerConnection, () => { if (!stale()) this.attachStream(stream); });
      });
      call.on('close', () => this.retry('Audio stopped. Reconnecting…', gen));
    });

    peer.on('error', (err) => {
      if (stale()) return;
      if (err.type === 'peer-unavailable') {
        this.retry('No monitor phone is using that passphrase yet. Waiting…', gen);
      } else if (err.type === 'browser-incompatible') {
        this.fail('This browser does not support the connection this page needs.');
      } else {
        this.retry('Could not reach the pairing service. Retrying…', gen);
      }
    });
  },

  /* ── mode B ── */
  async startLinkMode(inviteBlob) {
    const payload = await unseal(inviteBlob, this.pass);   // throws on a wrong passphrase
    if (payload.role !== 'offer') throw new Error('That is a reply link, not an invite.');
    this.sid = payload.sid;

    show('view-receiver');
    showPane('view-receiver', 'recReply');

    this.pc = new RTCPeerConnection({ iceServers: STUN });
    this.pc.ontrack = (e) => {
      const stream = e.streams[0];
      whenIceConnected(this.pc, () => this.attachStream(stream));
    };
    this.pc.ondatachannel = (e) => {
      e.channel.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data);
          if (msg.t === 'ping') {
            this.lastPing = Date.now();
            if (this.state === 'lost') this.setState('live', 'Listening');
          }
        } catch {}
      };
    };
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      if (state === 'failed' || state === 'closed') {
        this.setState('lost', 'Connection lost — ask for a new invite link');
      }
    };

    await this.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIceGathering(this.pc);
    if (!this.running) return;

    const blob = await seal({ sid: this.sid, role: 'answer', sdp: trimSdp(this.pc.localDescription.sdp) }, this.pass);
    this.replyLink = buildLink('r', blob);
    $('recReplyText').value = this.replyLink;

    wakeLock.acquire();
    this.tickTimer = setInterval(() => this.tick(), 1000);
  },

  /* ── shared ── */
  attachStream(stream) {
    clearTimeout(this.connectTimer);
    showPane('view-receiver', 'recActive');

    const el = $('remoteAudio');
    el.srcObject = stream;
    el.play().then(() => {
      $('recUnmute').classList.add('hidden');
    }).catch(() => {
      // Autoplay was refused — surface a button so the next tap starts it.
      $('recUnmute').classList.remove('hidden');
    });

    this.attempt = 0;
    this.connectedAt = this.connectedAt || Date.now();
    this.lastPing = Date.now();
    this.setState('live', 'Listening');

    clearInterval(this.watchTimer);
    this.watchTimer = setInterval(() => this.checkAlive(), 1000);
  },

  checkAlive() {
    if (!this.running || this.state !== 'live') return;
    if (Date.now() - this.lastPing > PING_TIMEOUT) {
      this.setState('lost', this.mode === 'passphrase'
        ? 'Signal lost — reconnecting…'
        : 'Signal lost — ask for a new invite link');
      if (this.mode === 'passphrase') this.retry('Signal lost — reconnecting…');
    }
  },

  setState(state, message) {
    this.state = state;
    $('recStatus').textContent = message;
    const dotClass = state === 'live' ? 'is-live' : state === 'lost' ? 'is-lost' : 'is-wait';
    $('recDot').className = 'dot ' + dotClass;
    $('recGlyph').textContent = state === 'live' ? '🔊' : state === 'lost' ? '🔇' : '📡';
    $('recGlyph').classList.toggle('is-lost', state !== 'live');

    if (state === 'lost') alarm.start(); else alarm.stop();
  },

  tick() {
    if (this.state === 'live' && this.connectedAt) {
      $('recSince').textContent = 'Connected for ' + fmtDuration(Date.now() - this.connectedAt);
    } else if (this.state === 'connecting' && this.attempt > 1) {
      $('recSince').textContent = `Attempt ${this.attempt}`;
    }
  },

  retry(message, gen) {
    if (!this.running || this.mode !== 'passphrase') return;
    if (gen !== undefined && gen !== this.gen) return;   // event from a superseded attempt
    if (this.retryTimer) return;

    clearInterval(this.watchTimer);
    this.setState(this.connectedAt ? 'lost' : 'connecting', message);

    const delay = Math.min(1000 * 2 ** Math.min(this.attempt, 4), 15000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.dial();
    }, delay);
  },

  fail(message) {
    this.running = false;
    this.teardownConnection();
    clearInterval(this.tickTimer);
    alarm.stop();
    wakeLock.release();
    showPane('view-receiver', 'recSetup');
    setBanner($('recSetupErr'), message);
  },

  teardownConnection() {
    clearTimeout(this.connectTimer);
    if (this.call) { try { this.call.close(); } catch {} this.call = null; }
    if (this.conn) { try { this.conn.close(); } catch {} this.conn = null; }
    if (this.peer) { try { this.peer.destroy(); } catch {} this.peer = null; }
  },

  stop() {
    this.running = false;
    this.gen++;
    clearInterval(this.tickTimer);
    clearInterval(this.watchTimer);
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.teardownConnection();
    if (this.pc) { try { this.pc.close(); } catch {} this.pc = null; }

    const el = $('remoteAudio');
    el.pause();
    el.srcObject = null;

    alarm.stop();
    wakeLock.release();
    this.connectedAt = 0;
    this.state = 'connecting';
    showPane('view-receiver', 'recSetup');
    show('view-landing');
  },
};

/* ══════════════════════════ wiring ══════════════════════════ */

function bindSegmented(containerId, onChange) {
  const container = $(containerId);
  container.addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    container.querySelectorAll('.seg').forEach((s) => s.classList.toggle('is-active', s === seg));
    const mode = seg.dataset.mode;
    container.parentElement.querySelectorAll('[data-hint-for]').forEach((h) => {
      h.classList.toggle('hidden', h.dataset.hintFor !== mode);
    });
    onChange(mode);
  });
  return () => container.querySelector('.seg.is-active').dataset.mode;
}

function boot() {
  const savedPass = localStorage.getItem('bm:lastPass') || '';
  $('monPass').value = savedPass;
  $('recPass').value = savedPass;

  if (!window.isSecureContext) {
    setBanner($('landingWarn'),
      'This page needs a secure (https://) connection to use the microphone.');
  }

  /* landing */
  $('btnBeMonitor').addEventListener('click', () => {
    unlockAudio();
    show('view-monitor');
    showPane('view-monitor', 'monSetup');
  });
  $('btnBeReceiver').addEventListener('click', () => {
    unlockAudio();
    show('view-receiver');
    showPane('view-receiver', 'recSetup');
  });

  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => show('view-landing'));
  });
  document.querySelectorAll('#view-monitor [data-stop]').forEach((btn) => {
    btn.addEventListener('click', () => monitor.stop());
  });
  document.querySelectorAll('#view-receiver [data-stop]').forEach((btn) => {
    btn.addEventListener('click', () => receiver.stop());
  });

  /* monitor setup */
  const monMode = bindSegmented('monMode', () => setBanner($('monSetupErr'), ''));
  $('monGen').addEventListener('click', () => { $('monPass').value = generatePassphrase(); });

  $('monStart').addEventListener('click', async () => {
    const pass = $('monPass').value.trim();
    if (normalizePass(pass).length < 8) {
      setBanner($('monSetupErr'), 'Use a passphrase of at least 8 characters — tap Generate for a strong one.');
      return;
    }
    setBanner($('monSetupErr'), '');
    $('monStart').disabled = true;
    $('monStart').textContent = 'Starting…';
    try {
      unlockAudio();
      await monitor.start(monMode(), pass);
    } catch (err) {
      monitor.stop();
      show('view-monitor');
      showPane('view-monitor', 'monSetup');
      setBanner($('monSetupErr'), err.message || String(err));
    } finally {
      $('monStart').disabled = false;
      $('monStart').textContent = 'Start Monitoring';
    }
  });

  $('monShare').addEventListener('click', async () => {
    const result = await shareOrCopy(monitor.inviteLink, 'invite link');
    if (result === 'copied') flashButton($('monShare'), 'Copied');
  });
  $('monCopy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(monitor.inviteLink).catch(() => {});
    flashButton($('monCopy'), 'Copied');
  });
  $('monAnswerGo').addEventListener('click', () => monitor.acceptAnswer($('monAnswerInput').value));

  $('monStop').addEventListener('click', () => monitor.stop());
  $('monDim').addEventListener('click', () => {
    $('monDim').classList.add('hidden');
    monitor.scheduleDim();
  });

  /* receiver setup */
  let pendingInvite = null;
  const recMode = bindSegmented('recMode', (mode) => {
    $('recLinkField').classList.toggle('hidden', mode !== 'link');
    setBanner($('recSetupErr'), '');
  });

  $('recStart').addEventListener('click', async () => {
    const pass = $('recPass').value.trim();
    if (!pass) {
      setBanner($('recSetupErr'), 'Enter the passphrase from the monitor phone.');
      return;
    }
    const mode = recMode();
    let blob = null;
    if (mode === 'link') {
      blob = extractBlob($('recInviteInput').value) || pendingInvite;
      if (!blob) {
        setBanner($('recSetupErr'), 'Paste the invite link the monitor phone sent you.');
        return;
      }
    }
    setBanner($('recSetupErr'), '');
    $('recStart').disabled = true;
    $('recStart').textContent = 'Connecting…';
    try {
      await receiver.start(mode, pass, blob);
    } catch (err) {
      receiver.stop();
      show('view-receiver');
      showPane('view-receiver', 'recSetup');
      setBanner($('recSetupErr'), err.message || String(err));
    } finally {
      $('recStart').disabled = false;
      $('recStart').textContent = 'Connect';
    }
  });

  $('recShare').addEventListener('click', async () => {
    const result = await shareOrCopy(receiver.replyLink, 'reply link');
    if (result === 'copied') flashButton($('recShare'), 'Copied');
  });
  $('recCopy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(receiver.replyLink).catch(() => {});
    flashButton($('recCopy'), 'Copied');
  });
  $('recUnmute').addEventListener('click', () => {
    unlockAudio();
    $('remoteAudio').play().then(() => $('recUnmute').classList.add('hidden')).catch(() => {});
  });
  $('recStop').addEventListener('click', () => receiver.stop());

  /* return page (monitor phone opened a reply link) */
  $('retCopy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('retCode').value).catch(() => {});
    flashButton($('retCopy'), 'Copied');
  });

  /* routing off the URL fragment */
  const hash = location.hash || '';
  const invite = hash.match(/^#i=([A-Za-z0-9_-]+)/);
  const reply = hash.match(/^#r=([A-Za-z0-9_-]+)/);

  if (invite) {
    pendingInvite = invite[1];
    history.replaceState(null, '', location.pathname);
    show('view-receiver');
    showPane('view-receiver', 'recSetup');
    $('recMode').querySelectorAll('.seg').forEach((s) => s.classList.toggle('is-active', s.dataset.mode === 'link'));
    $('recLinkField').classList.add('hidden');   // we already have it; no need to paste
    document.querySelectorAll('#recSetup [data-hint-for]').forEach((h) => {
      h.classList.toggle('hidden', h.dataset.hintFor !== 'link');
    });
    $('recPass').focus();
  } else if (reply) {
    const blob = reply[1];
    history.replaceState(null, '', location.pathname);
    show('view-return');
    $('retCode').value = blob;
    handoffPost(HANDOFF_ANSWER, blob);

    const stop = handoffListen(HANDOFF_ACK, () => {
      stop();
      $('retTitle').textContent = 'Connected';
      $('retSpin').classList.add('hidden');
      $('retMsg').textContent = 'Your monitoring screen has the reply. You can close this tab.';
      $('retFallback').classList.add('hidden');
    });

    setTimeout(() => {
      if ($('retTitle').textContent === 'Connecting…') {
        $('retTitle').textContent = 'Almost there';
        $('retSpin').classList.add('hidden');
        $('retMsg').textContent = 'Switch back to the tab showing your monitoring screen — it should pick this up. If it does not, use the code below.';
        $('retFallback').open = true;
      }
    }, 6000);
  } else {
    show('view-landing');
  }
}

document.addEventListener('DOMContentLoaded', boot);
