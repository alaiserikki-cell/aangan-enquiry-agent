// Single-password dashboard auth. The cookie holds an HMAC derived from DASHBOARD_PASSWORD,
// so changing the password logs everyone out. Web Crypto only, so it runs in proxy.ts too.

export const SESSION_COOKIE = "aangan_dash";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export async function sessionToken(): Promise<string | null> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("aangan-dashboard-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  const expected = await sessionToken();
  return !!expected && !!cookieValue && constantTimeEqual(cookieValue, expected);
}
