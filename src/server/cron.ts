import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Scheduled job endpoints (/api/email/send, /api/maintenance) only work with an "Authorization: Bearer <CRON_SECRET>"
 * header; if CRON_SECRET is not set or shorter than 24 characters the endpoints are closed.
 */
export function cronAuthorized(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 24) return false;
  const given = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
