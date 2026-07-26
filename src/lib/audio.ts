let audioCtx: AudioContext | null = null;

/**
 * Must be called from inside a user gesture — iOS will not start audio otherwise, and the
 * alarm needs a live context to be able to sound later.
 */
export function unlockAudio(): AudioContext | null {
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  }
  if (audioCtx?.state === 'suspended') void audioCtx.resume().catch(() => {});
  return audioCtx;
}

/**
 * Two-tone beep repeating while the link is down. The whole point of a baby monitor is that
 * silence is ambiguous — it could be a sleeping baby or a dead connection — so losing the
 * link has to be audible, not just visible on a screen nobody is watching.
 */
class Alarm {
  private timer: ReturnType<typeof setInterval> | null = null;

  get sounding(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer || !audioCtx) return;
    this.beep();
    this.timer = setInterval(() => this.beep(), 2500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private beep(): void {
    const ctx = audioCtx;
    if (!ctx) return;
    [880, 660].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const at = ctx.currentTime + i * 0.35;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    });
  }
}

export const alarm = new Alarm();

/**
 * Echo cancellation, noise suppression and automatic gain are all tuned for speech on a phone
 * call. They treat a sleeping baby's breathing and whimpering as noise to remove, which is
 * exactly the signal we care about, so every one of them is turned off.
 */
export async function getMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot access the microphone. Try Safari or Chrome.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('Microphone access was blocked. Allow it in your browser settings and try again.');
    }
    if (name === 'NotFoundError') throw new Error('No microphone found on this phone.');
    throw new Error(
      'Could not start the microphone: ' + (err instanceof Error ? err.message : String(err)),
    );
  }
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'prompted';

/** Native share sheet where available, clipboard otherwise, prompt as a last resort. */
export async function shareOrCopy(text: string, label: string): Promise<ShareOutcome> {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    window.prompt(`Copy the ${label}:`, text);
    return 'prompted';
  }
}
