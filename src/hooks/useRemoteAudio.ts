import { useCallback, useEffect, useRef, useState } from 'react';
import { unlockAudio } from '../lib/audio';

/**
 * Drives the `<audio>` element for the incoming stream.
 *
 * `srcObject` cannot be expressed as a prop, so the element is reached through a ref. If
 * autoplay is refused the caller shows a button, because only a real tap can start playback.
 */
export function useRemoteAudio(stream: MediaStream | null) {
  const ref = useRef<HTMLAudioElement>(null);
  const [needsGesture, setNeedsGesture] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!stream) {
      el.pause();
      el.srcObject = null;
      setNeedsGesture(false);
      return;
    }

    el.srcObject = stream;
    el.play().then(
      () => setNeedsGesture(false),
      () => setNeedsGesture(true),
    );
  }, [stream]);

  const start = useCallback(() => {
    unlockAudio();
    void ref.current?.play().then(
      () => setNeedsGesture(false),
      () => {},
    );
  }, []);

  return { ref, needsGesture, start };
}
