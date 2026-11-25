/**
 * Keeps the screen on. This is load-bearing rather than a nicety: both iOS and Android cut
 * microphone access when the browser is backgrounded or the screen locks, so the monitor
 * phone's screen staying on is what keeps the stream alive.
 */
class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  readonly supported = 'wakeLock' in navigator;

  constructor() {
    // iOS drops the lock whenever the page is backgrounded, so take it back on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wanted) void this.acquire();
    });
  }

  /** Resolves false when the browser will not hold the screen awake, so the UI can say so. */
  async acquire(): Promise<boolean> {
    this.wanted = true;
    if (!this.supported) return false;
    if (this.sentinel && !this.sentinel.released) return true;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        // The system can drop the lock while the page is still in front (Android battery
        // saver, a brief permission sheet). Ask again rather than letting the screen sleep.
        if (this.wanted) {
          setTimeout(() => {
            if (this.wanted && document.visibilityState === 'visible') void this.acquire();
          }, 1000);
        }
      });
      return true;
    } catch {
      this.sentinel = null;
      return false;
    }
  }

  release(): void {
    this.wanted = false;
    void this.sentinel?.release().catch(() => {});
    this.sentinel = null;
  }
}

export const wakeLock = new WakeLockManager();
