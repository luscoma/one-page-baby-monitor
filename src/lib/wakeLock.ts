/**
 * Keeps the screen on. This is load-bearing rather than a nicety: both iOS and Android cut
 * microphone access when the browser is backgrounded or the screen locks, so the monitor
 * phone's screen staying on is what keeps the stream alive.
 */
class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private listeners = new Set<(held: boolean) => void>();

  readonly supported = 'wakeLock' in navigator;

  /** Why the last request failed, for the on-screen notice. Empty once a request succeeds. */
  lastError = '';

  constructor() {
    // iOS drops the lock whenever the page is backgrounded, so take it back on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wanted) void this.acquire();
    });
    // Safari can refuse a request that does not come from a tap. If the lock is wanted but
    // not held, any tap on the page is another chance to get it.
    document.addEventListener('pointerdown', () => {
      if (this.wanted && !this.held) void this.acquire();
    }, { capture: true });
  }

  get held(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  /** Called whenever the lock is gained or lost, so a notice can be shown or cleared. */
  onChange(fn: (held: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const held = this.held;
    this.listeners.forEach((fn) => fn(held));
  }

  /** Resolves false when the browser will not hold the screen awake, so the UI can say so. */
  async acquire(): Promise<boolean> {
    this.wanted = true;
    if (!this.supported) {
      this.lastError = 'not supported by this browser';
      return false;
    }
    if (this.held) return true;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!this.wanted) {
        // Released while the request was in flight.
        void sentinel.release().catch(() => {});
        return false;
      }
      if (this.held) {
        // A concurrent request won; keep that one.
        void sentinel.release().catch(() => {});
        return true;
      }
      this.sentinel = sentinel;
      this.lastError = '';
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
        this.emit();
        // The system can drop the lock while the page is still in front (Android battery
        // saver, a brief permission sheet). Ask again rather than letting the screen sleep.
        if (this.wanted) {
          setTimeout(() => {
            if (this.wanted && document.visibilityState === 'visible') void this.acquire();
          }, 1000);
        }
      });
      this.emit();
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message || err.name : String(err);
      this.emit();
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
