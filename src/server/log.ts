import "server-only";

/**
 * Server logs. Personal data (name, ID/passport number, form answers, file names)
 * is NEVER LOGGED: only the action name, error code and error message are recorded.
 * The `details` / `hint` fields of Postgres errors are skipped because they can contain row content.
 */
type ErrorLike = { code?: unknown; message?: unknown; name?: unknown; status?: unknown };

function describe(error: unknown): Record<string, string> {
  if (typeof error !== "object" || error === null) return { message: String(error).slice(0, 300) };
  const e = error as ErrorLike;
  const out: Record<string, string> = {};
  if (typeof e.name === "string") out.name = e.name;
  if (typeof e.code === "string" || typeof e.code === "number") out.code = String(e.code);
  if (typeof e.status === "number") out.status = String(e.status);
  if (typeof e.message === "string") out.message = e.message.slice(0, 300);
  return out;
}

export function logError(operation: string, error: unknown, context: Record<string, string | number | boolean> = {}): void {
  console.error(JSON.stringify({ level: "error", operation, ...describe(error), ...context }));
}

export function logWarning(operation: string, context: Record<string, string | number | boolean> = {}): void {
  console.warn(JSON.stringify({ level: "warn", operation, ...context }));
}
