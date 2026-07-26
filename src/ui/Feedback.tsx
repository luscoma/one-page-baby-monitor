import type { ReactNode } from 'react';
import styles from './Feedback.module.css';

/** Renders nothing when there is no message, so callers can pass state straight through. */
export function Banner({
  kind = 'error',
  children,
  testId,
}: {
  kind?: 'error' | 'warn';
  children?: ReactNode;
  testId?: string;
}) {
  if (!children) return null;
  return (
    <p className={`${styles.banner} ${styles[kind]}`} data-testid={testId} role="alert">
      {children}
    </p>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <div className={`${styles.spinner} ${small ? styles.small : ''}`} aria-hidden />;
}

export function WaitingRow({ children }: { children: ReactNode }) {
  return (
    <div className={styles.waitingRow}>
      <Spinner small />
      <span>{children}</span>
    </div>
  );
}

export type DotState = 'live' | 'wait' | 'lost';

export function StatusDot({ state, testId }: { state: DotState; testId?: string }) {
  return <div className={`${styles.dot} ${styles[state]}`} data-testid={testId} data-state={state} />;
}

export function CodeBox({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className={styles.codebox}>
      <code data-testid={testId}>{children}</code>
    </div>
  );
}
