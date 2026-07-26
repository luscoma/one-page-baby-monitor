import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Explanatory line shown under the control when this option is selected. */
  hint?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testId,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  testId?: string;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <div className={styles.segmented} role="tablist" data-testid={testId}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={option.value === value}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
            className={`${styles.seg} ${option.value === value ? styles.active : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {selected?.hint ? <p className="hint">{selected.hint}</p> : null}
    </>
  );
}
