import { useState } from 'react';
import { Button } from '../Button';
import { Banner } from '../Feedback';
import { Segmented } from '../Segmented';
import { MONITOR_MODE_OPTIONS } from '../modes';
import { generatePassphrase, isPassphraseLongEnough, MIN_PASSPHRASE_LENGTH } from '../../lib/passphrase';
import { unlockAudio } from '../../lib/audio';
import { monitor } from '../../session/MonitorSession';
import type { PairMode } from '../../types';

export function MonitorSetup({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<PairMode>('passphrase');
  const [passphrase, setPassphrase] = useState(() => localStorage.getItem('bm:lastPass') ?? '');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  async function start() {
    if (!isPassphraseLongEnough(passphrase)) {
      setError(
        `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters — tap Generate for a strong one.`,
      );
      return;
    }
    setError('');
    setStarting(true);
    try {
      // Has to happen inside the tap: iOS will not start audio outside a gesture.
      unlockAudio();
      await monitor.start(mode, passphrase.trim());
    } catch (err) {
      monitor.stop();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="pane">
      <button type="button" className="link-back" onClick={onBack}>
        ← Back
      </button>
      <h2>Monitor phone</h2>

      <div className="field">
        <span className="label">How should the other phone connect?</span>
        <Segmented options={MONITOR_MODE_OPTIONS} value={mode} onChange={setMode} testId="monitor-mode" />
      </div>

      <div className="field">
        <label className="label" htmlFor="monitor-pass">
          Passphrase
        </label>
        <div className="row">
          <input
            id="monitor-pass"
            className="input"
            data-testid="monitor-pass"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="e.g. quiet-otter-4821"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <Button variant="ghost" onClick={() => setPassphrase(generatePassphrase())} data-testid="monitor-generate">
            Generate
          </Button>
        </div>
        <p className="hint">Anyone who knows this can listen in, so pick something no one would guess.</p>
      </div>

      <Button variant="primary" big onClick={() => void start()} disabled={starting} data-testid="monitor-start">
        {starting ? 'Starting…' : 'Start Monitoring'}
      </Button>
      <Banner testId="monitor-setup-error">{error}</Banner>
    </div>
  );
}
