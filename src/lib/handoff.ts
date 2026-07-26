/**
 * Cross-tab handoff for the link-mode return trip.
 *
 * When the monitor phone taps the reply link it opens a second tab, which cannot itself hold
 * the waiting peer connection. That tab drops the answer here and the original tab picks it
 * up. Best-effort by design: some in-app browsers keep separate storage, so the UI always
 * offers a paste-the-code fallback.
 */

export const HANDOFF_ANSWER = 'bm:answer';
export const HANDOFF_ACK = 'bm:ack';

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('bm-signal') : null;

export function handoffPost(key: string, value: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ key, value, at: Date.now() }));
  } catch {
    // Private browsing can refuse storage; the BroadcastChannel may still get through.
  }
  channel?.postMessage({ key, value });
}

/** Returns an unsubscribe function. */
export function handoffListen(key: string, onValue: (value: string) => void): () => void {
  const fromStorage = (e: StorageEvent) => {
    if (e.key !== key || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as { value?: unknown };
      if (typeof parsed.value === 'string') onValue(parsed.value);
    } catch {
      // Ignore anything that is not ours.
    }
  };
  const fromChannel = (e: MessageEvent) => {
    const data = e.data as { key?: unknown; value?: unknown } | null;
    if (data && data.key === key && typeof data.value === 'string') onValue(data.value);
  };

  window.addEventListener('storage', fromStorage);
  channel?.addEventListener('message', fromChannel);
  return () => {
    window.removeEventListener('storage', fromStorage);
    channel?.removeEventListener('message', fromChannel);
  };
}
