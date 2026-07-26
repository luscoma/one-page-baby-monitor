/**
 * The smallest thing that satisfies `useSyncExternalStore`.
 *
 * Session controllers extend this so React can render them without owning any of their
 * lifecycle. `getSnapshot` returns a stable reference until something genuinely changes, which
 * is what `useSyncExternalStore` requires to avoid re-rendering forever.
 */
export class Store<T extends object> {
  private subscribers = new Set<() => void>();
  private snapshot: T;

  constructor(initial: T) {
    this.snapshot = initial;
  }

  getSnapshot = (): T => this.snapshot;

  subscribe = (onChange: () => void): (() => void) => {
    this.subscribers.add(onChange);
    return () => {
      this.subscribers.delete(onChange);
    };
  };

  protected get state(): Readonly<T> {
    return this.snapshot;
  }

  /** No-op when every supplied value already matches, so repeat calls do not cause renders. */
  protected patch(next: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(next) as (keyof T)[]) {
      if (!Object.is(this.snapshot[key], next[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.snapshot = { ...this.snapshot, ...next };
    this.subscribers.forEach((fn) => fn());
  }
}
