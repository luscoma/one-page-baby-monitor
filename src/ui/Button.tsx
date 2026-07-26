import { useCallback, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  /** Tall two-line button used for the primary choices. */
  big?: boolean;
  grow?: boolean;
  note?: ReactNode;
}

export function Button({ variant = 'secondary', big, grow, note, children, ...rest }: Props) {
  const classes = [styles.btn, styles[variant]];
  if (big) classes.push(styles.big);
  if (grow) classes.push(styles.grow);

  return (
    <button type="button" className={classes.join(' ')} {...rest}>
      {big ? <span className={styles.title}>{children}</span> : children}
      {note ? <span className={styles.note}>{note}</span> : null}
    </button>
  );
}

/**
 * Button whose label briefly changes to confirm an action, for cases where nothing else on
 * screen moves — copying a link, mostly.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  ...rest
}: Omit<Props, 'onClick'> & { confirmLabel: string; onConfirm: () => Promise<boolean> | boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handle = useCallback(() => {
    void (async () => {
      if (!(await onConfirm())) return;
      setConfirmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirmed(false), 1600);
    })();
  }, [onConfirm]);

  return (
    <Button onClick={handle} {...rest}>
      {confirmed ? confirmLabel : children}
    </Button>
  );
}
