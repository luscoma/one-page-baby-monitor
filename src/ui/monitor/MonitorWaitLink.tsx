import { useState } from 'react';
import { Button, ConfirmButton } from '../Button';
import { Banner } from '../Feedback';
import { shareOrCopy } from '../../lib/audio';
import { monitor } from '../../session/MonitorSession';
import type { MonitorSnapshot } from '../../types';

export function MonitorWaitLink({
  snapshot,
  onExit,
}: {
  snapshot: MonitorSnapshot;
  onExit: () => void;
}) {
  const [reply, setReply] = useState('');
  const stop = () => {
    monitor.stop();
    onExit();
  };
  const link = snapshot.inviteLink;

  return (
    <div className="pane">
      <button type="button" className="link-back" onClick={stop}>
        ← Stop
      </button>

      <h2>Step 1 — send the invite</h2>
      <p className="lead">
        Send this link to the listening phone, then tell them the passphrase separately. The link on
        its own is useless without it.
      </p>
      <div className="row">
        <Button
          variant="primary"
          grow
          disabled={!link}
          onClick={() => void shareOrCopy(link ?? '', 'invite link')}
          data-testid="monitor-share"
        >
          Share link
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
        <summary>Show the link</summary>
        <textarea
          className="textarea"
          data-testid="monitor-invite-link"
          readOnly
          rows={4}
          value={link ?? 'Building invite…'}
        />
      </details>

      <h2 className="mt">Step 2 — paste their reply</h2>
      <p className="lead">
        The other phone will send back a reply link. Open it on this phone and it should connect
        automatically. If it doesn't, paste the reply code here.
      </p>
      <textarea
        className="textarea"
        data-testid="monitor-reply-input"
        rows={3}
        placeholder="Paste the reply link or code"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
      />
      <Button variant="primary" onClick={() => void monitor.acceptAnswer(reply)} data-testid="monitor-reply-go">
        Connect
      </Button>
      <Banner testId="monitor-link-notice">{snapshot.notice}</Banner>
    </div>
  );
}
