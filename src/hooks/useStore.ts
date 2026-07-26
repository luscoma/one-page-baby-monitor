import { useSyncExternalStore } from 'react';
import type { Store } from '../session/Store';

/** Renders a session controller without React owning any part of its lifecycle. */
export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
