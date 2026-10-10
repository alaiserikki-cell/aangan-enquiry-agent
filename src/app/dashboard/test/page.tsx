import Link from "next/link";
import { requireSession } from "@/lib/require-session";
import { SCENARIOS } from "@/lib/sim-scenarios";
import styles from "../dashboard.module.css";
import { clearSimulations, runSimulation } from "./actions";

export const metadata = { title: "Test calls · Aangan Enquiries" };

// Private page behind the dashboard password: a blocking render is intended.
export const instant = false;

// A test run waits for classification (Gemini can take ~30 s under load, with retries).
export const maxDuration = 60;

const OUTCOME_LABEL: Record<string, string> = {
  qualified: "Qualified",
  declined: "Declined",
  needs_review: "Needs review",
  existing_client: "Existing client",
  not_a_lead: "Not a lead",
};

export default async function TestPage({ searchParams }: PageProps<"/dashboard/test">) {
  await requireSession();
  const sp = await searchParams;

  return (
    <main className={styles.shell}>
      <Link href="/dashboard" className={styles.back}>
        ← Dashboard
      </Link>
      <div className={styles.pageHead} style={{ marginTop: 10 }}>
        <div>
          <h1 className={styles.pageTitle}>Test calls</h1>
          <p className={styles.pageSub}>
            Runs a call transcript through the live system: Gemini classification, routing, designer and escalation emails (test mode, to the test inbox), and the dashboard. No Vaani minutes are used. Each run takes about 10 seconds.
          </p>
        </div>
      </div>

      {sp.cleared ? <p className={styles.ok}>All test calls removed.</p> : null}
      {sp.error === "limit" ? <p className={styles.error}>Test-run limit reached (30 per hour). Please try again later.</p> : null}
      {sp.error && sp.error !== "limit" ? <p className={styles.error}>That transcript needs at least two lines starting with &quot;Agent:&quot; or &quot;Caller:&quot;.</p> : null}

      <section className={styles.widget}>
        <header className={styles.widgetHead}>
          <div>
            <h2 className={styles.widgetTitle}>Sample calls</h2>
            <p className={styles.widgetSub}>One for each rule in the test set, plus a wrong number and a deliberate price-rule breach</p>
          </div>
        </header>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Case</th>
                <th>Call</th>
                <th>Rule checked</th>
                <th>Expected</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {SCENARIOS.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.id}</td>
                  <td>{s.title}</td>
                  <td className={styles.muted}>{s.rule}</td>
                  <td>
                    <span className={styles.pill}>{OUTCOME_LABEL[s.expected] ?? s.expected}</span>
                    {s.expectedReason ? <span className={styles.muted}> {s.expectedReason.replace(/_/g, " ")}</span> : null}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <form action={runSimulation}>
                      <input type="hidden" name="scenario" value={s.id} />
                      <button type="submit" className={styles.button} style={{ padding: "6px 14px", fontSize: 13 }}>
                        Run
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.widget} style={{ marginTop: 16 }}>
        <header className={styles.widgetHead}>
          <div>
            <h2 className={styles.widgetTitle}>Paste your own transcript</h2>
            <p className={styles.widgetSub}>Lines starting with &quot;Agent:&quot; and &quot;Caller:&quot; (Vaani&apos;s &quot;[hh:mm:ss] AGENT: / USER:&quot; format works too)</p>
          </div>
        </header>
        <form action={runSimulation} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            name="transcript"
            rows={10}
            required
            className={styles.input}
            style={{ fontFamily: "inherit", resize: "vertical" }}
            placeholder={"Agent: Hello, thank you for calling Aangan Studio...\nCaller: Hi, I have a 2BHK in Wakad..."}
          />
          <div>
            <button type="submit" className={styles.button}>
              Run this call
            </button>
          </div>
        </form>
      </section>

      <form action={clearSimulations} style={{ marginTop: 16 }}>
        <button type="submit" className={styles.pill} style={{ cursor: "pointer", padding: "8px 14px" }}>
          Clear all test calls
        </button>
        <span className={styles.muted} style={{ marginLeft: 10 }}>Deletes only calls created on this page, never real Vaani calls.</span>
      </form>
    </main>
  );
}
