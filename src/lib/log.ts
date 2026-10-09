// Logging that never writes caller phone numbers. Use this instead of console.* in server code.

const PHONE_PATTERN = /(\+?\d[\d\s-]{7,}\d)/g;

export function redactPhones(text: string): string {
  return text.replace(PHONE_PATTERN, (m) => (m.replace(/\D/g, "").length >= 8 ? "[phone]" : m));
}

function emit(level: "info" | "warn" | "error", event: string, data?: unknown) {
  const line = redactPhones(JSON.stringify({ level, event, ...(data ? { data } : {}) }));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, data?: unknown) => emit("info", event, data),
  warn: (event: string, data?: unknown) => emit("warn", event, data),
  error: (event: string, err: unknown, data?: Record<string, unknown>) =>
    emit("error", event, { ...data, error: err instanceof Error ? err.message : String(err) }),
};
