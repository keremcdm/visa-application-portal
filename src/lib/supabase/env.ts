/**
 * Supabase connection details. Only values that may be sent to the browser are here;
 * the secret key is in src/lib/supabase/admin.ts and read only on the server.
 */
export type SupabasePublicEnv = { url: string; publishableKey: string };

export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return null;
  } catch {
    return null;
  }
  return { url, publishableKey };
}

/** If Supabase is not configured the app says so clearly; it never fakes a session or data. */
export function isSupabaseConfigured(): boolean {
  return getSupabasePublicEnv() !== null;
}

export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}
