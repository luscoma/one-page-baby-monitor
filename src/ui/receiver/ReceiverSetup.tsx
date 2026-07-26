import { useState } from 'react';
import { Button } from '../Button';
import { Banner } from '../Feedback';
import { Segmented } from '../Segmented';
import { RECEIVER_MODE_OPTIONS } from '../modes';
import { unlockAudio } from '../../lib/audio';
import { extractBlob } from '../../lib/invite';
import { receiver } from '../../session/ReceiverSession';
import type { PairMode } from '../../types';

export function ReceiverSetup({
  onBack,
  pendingInvite,
  fatalError,
}: {
  onBack: () => void;
  /** Set when the page was opened from an invite link, so there is nothing to paste. */
  pendingInvite: string | null;
  fatalError: string | null;
}) {
  const [mode, setMode] = useState<PairMode>(pendingInvite ? 'link' : 'passphrase');
  const [passphrase, setPassphrase] = useState(() => localStorage.getItem('bm:lastPass') ?? '');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    if (!passphrase.trim()) {
      setError('Enter the passphrase from the monitor phone.');
      return;
    }
    setError('');
    receiver.clearError();
    setConnecting(true);
    try {
      // Has to happen inside the tap: iOS will not start audio outside a gesture.
      unlockAudio();
      if (mode === 'link') {
        const blob = extractBlob(invite) ?? pendingInvite;
        if (!blob) {
          setError('Paste the invite link the monitor phone sent you.');
          return;
        }
        await receiver.startLink(blob, passphrase.trim());
      } else {
        await receiver.startPassphrase(passphrase.trim());
      }
    } catch (err) {
      receiver.stop();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="pane">
      <button type="button" className="link-back" onClick={onBack}>
        ← Back
      </button>
      <h2>Listening phone</h2>

      <div className="field">
        <span className="label">How are you connecting?</span>
        <Segmented options={RECEIVER_MODE_OPTIONS} value={mode} onChange={setMode} testId="receiver-mode" />
      </div>

      <div className="field">
        <label className="label" htmlFor="receiver-pass">
          Passphrase
        </label>
        <input
          id="receiver-pass"
          className="input"
          data-testid="receiver-pass"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="The passphrase from the monitor phone"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
        {pendingInvite ? (
          <p className="hint">Invite link received. Just enter the passphrase to connect.</p>
        ) : null}
      </div>

      {mode === 'link' && !pendingInvite ? (
        <div className="field">
          <label className="label" htmlFor="receiver-invite">
            Invite link
          </label>
          <textarea
            id="receiver-invite"
            className="textarea"
            data-testid="receiver-invite-input"
            rows={3}
            placeholder="Paste the invite link"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
          />
        </div>
      ) : null}

      <Button variant="primary" big onClick={() => void connect()} disabled={connecting} data-testid="receiver-start">
        {connecting ? 'Connecting…' : 'Connect'}
      </Button>
      <Banner testId="receiver-setup-error">{error || fatalError}</Banner>
    </div>
  );
}
