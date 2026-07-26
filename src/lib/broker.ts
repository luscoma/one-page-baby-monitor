import type { PeerOptions } from 'peerjs';
import { STUN_SERVERS } from './webrtc';

/**
 * Options for a PeerJS client. Defaults to the free PeerJS cloud broker, which only ever sees
 * a slow hash of the passphrase and never any audio. `?broker=host:port/path` points at your
 * own peerjs-server instead, which keeps even the handshake off a third party.
 */
export function brokerOptions(): PeerOptions {
  const base: PeerOptions = { debug: 0, config: { iceServers: STUN_SERVERS } };
  const broker = new URLSearchParams(location.search).get('broker');
  if (!broker) return base;

  const parts = broker.match(/^([^:/]+)(?::(\d+))?(\/.*)?$/);
  if (!parts) return base;

  const secure = location.protocol === 'https:';
  return {
    ...base,
    host: parts[1],
    port: parts[2] ? Number(parts[2]) : secure ? 443 : 80,
    path: parts[3] || '/',
    secure,
  };
}
