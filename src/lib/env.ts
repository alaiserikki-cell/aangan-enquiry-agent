// Central env access. Read lazily so the replay script and build don't need
// every key present, but fail loudly the moment a missing one is actually used.

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function envOptional(name: string, fallback = ""): string {
  return process.env[name] || fallback;
}

/** A numeric rate from env. Missing rates count as 0 and are flagged on the dashboard. */
export function envRate(name: string): { value: number; missing: boolean } {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return { value: 0, missing: true };
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return { value, missing: false };
}

export function appUrl(): string {
  return envOptional("APP_URL", "http://localhost:3000").replace(/\/$/, "");
}
