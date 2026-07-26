import { Button } from './Button';
import { Banner } from './Feedback';
import styles from './Landing.module.css';

export function Landing({
  onBeMonitor,
  onBeReceiver,
}: {
  onBeMonitor: () => void;
  onBeReceiver: () => void;
}) {
  return (
    <div className="pane">
      <div className={styles.hero}>
        <div className={styles.icon}>👶</div>
        <h1>Baby Monitor</h1>
        <p className="sub">
          Two phones, one Wi-Fi network. Audio streams straight from one to the other.
        </p>
      </div>

      <div className="stack">
        <Button variant="primary" big onClick={onBeMonitor} note="Leave this phone with the baby" data-testid="be-monitor">
          Start Monitoring
        </Button>
        <Button variant="secondary" big onClick={onBeReceiver} note="Keep this phone with you" data-testid="be-receiver">
          Listen
        </Button>
      </div>

      <p className="fineprint">
        Audio travels directly between the two phones and is encrypted end to end. Nothing is
        recorded and no audio passes through any server.
      </p>

      {!window.isSecureContext ? (
        <Banner kind="warn">
          This page needs a secure (https://) connection to use the microphone.
        </Banner>
      ) : null}
    </div>
  );
}
