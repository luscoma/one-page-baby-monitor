import { Button } from '../Button';
import { Banner, StatusDot } from '../Feedback';
import { formatDuration } from '../../lib/format';
import { useElapsed } from '../../hooks/useElapsed';
import { monitor } from '../../session/MonitorSession';
import type { MonitorSnapshot } from '../../types';
import styles from '../ActiveScreen.module.css';

function describeListeners(count: number): string {
  if (count === 0) return 'No one listening yet';
  return count === 1 ? '1 phone listening' : `${count} phones listening`;
}

export function MonitorActive({
  snapshot,
  onExit,
}: {
  snapshot: MonitorSnapshot;
  onExit: () => void;
}) {
  const elapsed = useElapsed(snapshot.startedAt);
  const streaming = snapshot.listeners > 0;

  if (snapshot.dimmed) {
    return (
      <div className={`pane ${styles.pane}`}>
        <button type="button" className={styles.dim} onClick={() => monitor.wakeUi()} data-testid="monitor-dim">
          <span className={styles.dimInner}>
            <StatusDot state={streaming ? 'live' : 'wait'} />
            <span className={styles.dimStatus}>
              {streaming ? 'Streaming' : 'Waiting for a listener'}
            </span>
            <span className={styles.dimHint}>Tap to show controls</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={`pane ${styles.pane}`}>
      <div className={styles.top}>
        <StatusDot state={streaming ? 'live' : 'wait'} testId="monitor-dot" />
        <div>
          <div className={styles.status} data-testid="monitor-status">
            {streaming ? 'Streaming' : 'Ready'}
          </div>
          <div className={styles.sub} data-testid="monitor-since">
            Microphone on for {formatDuration(elapsed)}
          </div>
        </div>
      </div>

      <div className={styles.mid}>
        <div className={styles.glyph}>🎙️</div>
        <div className={styles.listeners} data-testid="monitor-listeners">
          {describeListeners(snapshot.listeners)}
        </div>
      </div>

      <div className={styles.bottom}>
        <Banner kind="warn" testId="monitor-notice">
          {snapshot.notice}
        </Banner>
        <p className="hint hint-center">
          Screen stays on so the microphone keeps running. Keep this page in front and plug the phone
          in.
        </p>
        <Button variant="danger" big onClick={() => {
            monitor.stop();
            onExit();
          }}
          data-testid="monitor-stop">
          Stop Monitoring
        </Button>
      </div>
    </div>
  );
}
