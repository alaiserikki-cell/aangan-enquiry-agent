import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isDashboardPublic, isValidSession } from "./auth";

/** Defence in depth: proxy.ts redirects too, but every private dashboard page re-checks. */
export async function requireSession(): Promise<void> {
  if (isDashboardPublic()) return;
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) redirect("/login");
}
