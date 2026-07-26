/** Shared vocabulary for both roles. */

/** How the two phones find each other. */
export type PairMode = 'passphrase' | 'link';

/**
 * Messages on the control channel, which is a PeerJS DataConnection in passphrase mode and a
 * raw RTCDataChannel in link mode. Typed as a union so both sides check against one
 * definition rather than matching string literals by hand.
 */
export type ControlMessage =
  | { t: 'challenge'; nonce: string }
  | { t: 'auth'; proof: string }
  | { t: 'denied' }
  | { t: 'ok' }
  | { t: 'ping'; at: number };

/** Narrows unknown wire data to a control message. */
export function isControlMessage(value: unknown): value is ControlMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === 'challenge' || t === 'auth' || t === 'denied' || t === 'ok' || t === 'ping';
}

/** What travels inside an encrypted invite or reply link. */
export interface SignalPayload {
  /** Session id, so a reply can be matched to the invite that asked for it. */
  sid: string;
  role: 'offer' | 'answer';
  sdp: string;
}

export function isSignalPayload(value: unknown): value is SignalPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.sid === 'string'
    && (v.role === 'offer' || v.role === 'answer')
    && typeof v.sdp === 'string';
}

/* ── monitor ── */

export type MonitorPhase =
  | 'idle'        // nothing running
  | 'waiting'     // registered, no listener yet (passphrase mode)
  | 'invite'      // invite link ready, waiting for a reply (link mode)
  | 'active';     // microphone live

export interface MonitorSnapshot {
  phase: MonitorPhase;
  mode: PairMode;
  passphrase: string;
  listeners: number;
  /** When the microphone went live, for the elapsed-time display. */
  startedAt: number | null;
  inviteLink: string | null;
  /** Warning or error text for whichever screen is showing. */
  notice: string;
  dimmed: boolean;
}

/* ── receiver ── */

export type LinkHealth = 'connecting' | 'live' | 'lost';

export type ReceiverPhase =
  | 'idle'
  | 'reply'       // link mode: reply link ready to send back
  | 'active';

export interface ReceiverSnapshot {
  phase: ReceiverPhase;
  mode: PairMode;
  health: LinkHealth;
  /** Human-readable status line, e.g. "Listening" or "Signal lost — reconnecting…". */
  message: string;
  connectedAt: number | null;
  attempt: number;
  replyLink: string | null;
  stream: MediaStream | null;
  /** Fatal problem that sent us back to the setup screen. */
  error: string | null;
}
