import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, constantTimeEqual, isDashboardPublic, sessionToken } from "@/lib/auth";
import styles from "../dashboard/dashboard.module.css";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || !constantTimeEqual(password, expected)) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  const store = await cookies();
  store.set(SESSION_COOKIE, (await sessionToken())!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(next.startsWith("/dashboard") ? next : "/dashboard");
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (isDashboardPublic()) redirect("/dashboard");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";
  return (
    <main className={styles.loginWrap}>
      <form action={login} className={styles.loginCard}>
        <h1 className={styles.h1}>Aangan dashboard</h1>
        <input type="hidden" name="next" value={next} />
        <label className={styles.label} htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={styles.input} autoFocus />
        {sp.error ? <p className={styles.error}>Wrong password.</p> : null}
        <button type="submit" className={styles.button}>Sign in</button>
      </form>
    </main>
  );
}
