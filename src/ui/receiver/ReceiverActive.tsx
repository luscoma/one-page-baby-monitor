import { Button } from '../Button';
import { StatusDot, type DotState } from '../Feedback';
import { formatDuration } from '../../lib/format';
import { useElapsed } from '../../hooks/useElapsed';
import { useRemoteAudio } from '../../hooks/useRemoteAudio';
import { receiver } from '../../session/ReceiverSession';
import type { LinkHealth, ReceiverSnapshot } from '../../types';
import styles from '../ActiveScreen.module.css';

const DOT: Record<LinkHealth, DotState> = { live: 'live', connecting: 'wait', lost: 'lost' };
const GLYPH: Record<LinkHealth, string> = { live: '🔊', connecting: '📡', lost: '🔇' };

export function ReceiverActive({
  snapshot,
  onExit,
}: {
  snapshot: ReceiverSnapshot;
  onExit: () => void;
}) {
  const elapsed = useElapsed(snapshot.connectedAt);
  const { ref, needsGesture, start } = useRemoteAudio(snapshot.stream);

  const detail = (() => {
    if (snapshot.health === 'live' && snapshot.connectedAt) {
      return `Connected for ${formatDuration(elapsed)}`;
    }
    if (snapshot.health === 'connecting' && snapshot.attempt > 1) return `Attempt ${snapshot.attempt}`;
    return '';
  })();

  return (
    <div className={`pane ${styles.pane}`}>
      <audio ref={ref} autoPlay playsInline data-testid="remote-audio" />

      <div className={styles.top}>
        <StatusDot state={DOT[snapshot.health]} testId="receiver-dot" />
        <div>
          <div className={styles.status} data-testid="receiver-status">
            {snapshot.message}
          </div>
          <div className={styles.sub} data-testid="receiver-since">
            {detail}
          </div>
        </div>
      </div>

      <div className={styles.mid}>
        <div
          className={`${styles.glyph} ${snapshot.health !== 'live' ? styles.glyphLost : ''}`}
          data-testid="receiver-glyph"
        >
          {GLYPH[snapshot.health]}
        </div>
        {needsGesture ? (
          <Button variant="primary" onClick={start} data-testid="receiver-unmute">
            Tap to start audio
          </Button>
        ) : null}
      </div>

      <div className={styles.bottom}>
        <p className="hint hint-center">
          Use the phone's volume buttons to adjust. You'll hear an alarm if the connection drops.
        </p>
        <Button variant="danger" big onClick={() => {
            receiver.stop();
            onExit();
          }}
          data-testid="receiver-stop">
          Disconnect
        </Button>
      </div>
    </div>
  );
}
