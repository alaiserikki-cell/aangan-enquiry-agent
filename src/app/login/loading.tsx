import styles from "../dashboard/dashboard.module.css";

export default function Loading() {
  return (
    <main className={styles.page}>
      <p className={styles.muted}>Loading…</p>
    </main>
  );
}
