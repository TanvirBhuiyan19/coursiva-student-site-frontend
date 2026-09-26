import styles from './Rating.module.css';

/**
 * Star rating with fractional fill (4.6 shows 4 full stars and 60% of the fifth). Exposed to assistive tech as a single
 * image with a text label — pass something like "Rated 4.6 out of 5".
 */
export function Rating({ value, label, size = 14 }: { value: number; label: string; size?: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className={styles.rating} role="img" aria-label={label} style={{ fontSize: size }}>
      <span className={styles.base} aria-hidden="true">
        ★★★★★
      </span>
      <span className={styles.fill} style={{ width: `${pct}%` }} aria-hidden="true">
        ★★★★★
      </span>
    </span>
  );
}
