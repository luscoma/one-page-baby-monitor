import { useEffect, useState } from 'react';
import { ConfirmButton } from './Button';
import { Spinner } from './Feedback';
import { HANDOFF_ACK, HANDOFF_ANSWER, handoffListen, handoffPost } from '../lib/handoff';

type Stage = 'handing-off' | 'stalled' | 'done';

const STALL_AFTER = 6000;

/**
 * Shown when the monitor phone opens a reply link. This tab cannot hold the waiting peer
 * connection, so it drops the answer where the original tab can pick it up.
 *
 * The handoff is best-effort — some in-app browsers keep separate storage from the main browser
 * — so if no acknowledgement arrives we surface the code for pasting by hand.
 */
export function ReturnView({ blob }: { blob: string }) {
  const [stage, setStage] = useState<Stage>('handing-off');

  useEffect(() => {
    const stopListening = handoffListen(HANDOFF_ACK, () => setStage('done'));
    handoffPost(HANDOFF_ANSWER, blob);

    const stallTimer = setTimeout(() => {
      setStage((current) => (current === 'done' ? current : 'stalled'));
    }, STALL_AFTER);

    return () => {
      stopListening();
      clearTimeout(stallTimer);
    };
  }, [blob]);

  return (
    <div className="pane">
      <h2 data-testid="return-title">
        {stage === 'done' ? 'Connected' : stage === 'stalled' ? 'Almost there' : 'Connecting…'}
      </h2>

      {stage === 'handing-off' ? <Spinner /> : null}

      <p className="lead" data-testid="return-message">
        {stage === 'done'
          ? 'Your monitoring screen has the reply. You can close this tab.'
          : stage === 'stalled'
            ? 'Switch back to the tab showing your monitoring screen — it should pick this up. If it does not, use the code below.'
            : 'Handing the reply back to your monitoring screen.'}
      </p>

      {stage !== 'done' ? (
        <details className="details" open={stage === 'stalled'}>
          <summary>It didn't connect automatically</summary>
          <p className="hint">
            Copy this code and paste it into the <strong>Step 2</strong> box on the monitoring screen.
          </p>
          <textarea className="textarea" data-testid="return-code" readOnly rows={4} value={blob} />
          <ConfirmButton
            variant="ghost"
            confirmLabel="Copied"
            onConfirm={async () => {
              try {
                await navigator.clipboard.writeText(blob);
                return true;
              } catch {
                return false;
              }
            }}
          >
            Copy code
          </ConfirmButton>
        </details>
      ) : null}
    </div>
  );
}
