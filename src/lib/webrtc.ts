export const STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
];

/**
 * Link mode has no live signaling channel, so every ICE candidate has to be in the SDP before
 * the link can be built. Resolves early if gathering finishes, and gives up after the timeout
 * with whatever candidates are in hand rather than hanging forever.
 */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 6000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * `ontrack` and PeerJS's `stream` event both fire as soon as the remote description lands,
 * long before audio can actually flow. The ICE state is the honest signal that the two phones
 * have a path to each other, so gate "we are connected" on this instead.
 */
export function whenIceConnected(pc: RTCPeerConnection, onConnected: () => void): void {
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

/**
 * Drops TCP candidates. On a home Wi-Fi the UDP host candidates are what actually connect,
 * and every line removed shortens the invite link that has to travel through a messenger.
 */
export function trimSdp(sdp: string): string {
  return sdp
    .split('\r\n')
    .filter((line) => !(line.startsWith('a=candidate:') && / tcp /i.test(line)))
    .join('\r\n');
}
