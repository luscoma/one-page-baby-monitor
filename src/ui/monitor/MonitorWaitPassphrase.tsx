import { Banner, CodeBox, Spinner } from '../Feedback';
import { monitor } from '../../session/MonitorSession';
import type { MonitorSnapshot } from '../../types';

export function MonitorWaitPassphrase({
  snapshot,
  onExit,
}: {
  snapshot: MonitorSnapshot;
  onExit: () => void;
}) {
  const stop = () => {
    monitor.stop();
    onExit();
  };

  return (
    <div className="pane">
      <button type="button" className="link-back" onClick={stop}>
        ← Stop
      </button>
      <h2>Waiting for a listener</h2>
      <Spinner />
      <p className="lead">
        On the other phone, open this page, tap <strong>Listen</strong> and enter:
      </p>
      <CodeBox testId="monitor-passphrase-echo">{snapshot.passphrase}</CodeBox>
      <p className="hint">
        Keep this screen open. The phone has to stay awake and unlocked for the microphone to keep
        running.
      </p>
      <Banner testId="monitor-wait-notice">{snapshot.notice}</Banner>
    </div>
  );
}
