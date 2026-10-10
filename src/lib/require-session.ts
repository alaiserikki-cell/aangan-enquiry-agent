import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SESSION_COOKIE, isDashboardPublic, isValidSession } from "./auth";

/** Defence in depth: proxy.ts redirects too, but every private dashboard page re-checks. */
export async function requireSession(): Promise<void> {
  // Public mode reads no cookie, so mark the render as per-request explicitly (pages use the current time).
  if (isDashboardPublic()) return connection();
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) redirect("/login");
}
