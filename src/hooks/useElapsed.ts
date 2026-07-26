import { useEffect, useState } from 'react';

/**
 * Milliseconds since `since`, ticking once a second.
 *
 * Deliberately kept out of the session snapshot: a timestamp living there would notify every
 * subscriber every second and re-render the whole tree just to advance a clock.
 */
export function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);

  return since === null ? 0 : Math.max(0, now - since);
}
