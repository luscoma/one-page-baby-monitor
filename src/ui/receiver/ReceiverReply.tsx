import { Button, ConfirmButton } from '../Button';
import { WaitingRow } from '../Feedback';
import { shareOrCopy } from '../../lib/audio';
import { receiver } from '../../session/ReceiverSession';
import type { ReceiverSnapshot } from '../../types';

export function ReceiverReply({
  snapshot,
  onExit,
}: {
  snapshot: ReceiverSnapshot;
  onExit: () => void;
}) {
  const link = snapshot.replyLink;
  const stop = () => {
    receiver.stop();
    onExit();
  };

  return (
    <div className="pane">
      <button type="button" className="link-back" onClick={stop}>
        ← Stop
      </button>
      <h2>Send this back</h2>
      <p className="lead">
        Send this reply link to the monitor phone. Once they open it, you'll be connected.
      </p>

      <div className="row">
        <Button
          variant="primary"
          grow
          disabled={!link}
          onClick={() => void shareOrCopy(link ?? '', 'reply link')}
          data-testid="receiver-share"
        >
          Share reply
        </Button>
        <ConfirmButton
          variant="ghost"
          confirmLabel="Copied"
          disabled={!link}
          onConfirm={async () => {
            if (!link) return false;
            try {
              await navigator.clipboard.writeText(link);
              return true;
            } catch {
              return false;
            }
          }}
        >
          Copy
        </ConfirmButton>
      </div>

      <details className="details">
        <summary>Show the reply link</summary>
        <textarea
          className="textarea"
          data-testid="receiver-reply-link"
          readOnly
          rows={4}
          value={link ?? 'Building reply…'}
        />
      </details>

      <WaitingRow>Waiting for the monitor phone…</WaitingRow>
    </div>
  );
}
