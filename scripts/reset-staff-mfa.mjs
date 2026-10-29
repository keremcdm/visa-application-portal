// RESETS A CONSULTANT'S TWO-FACTOR AUTHENTICATION (emergency use).
//
// Normally another consultant resets the authentication of a consultant who lost their phone from the admin panel
// (Settings → Staff → "Doğrulamayı sıfırla"). This script is only used when nobody can sign in to the panel
// (e.g. every consultant lost their phone at the same time). The person sets up the authenticator app again at next sign-in.
//
// Usage:
//   npm run staff:mfa-reset -- --email consultant@example.com
//
// Required environment variables (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
// This script uses the service role key; it must only be run by an authorized person on a secure machine.
import { existsSync } from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");

const index = process.argv.indexOf("--email");
const email = (index === -1 ? "" : (process.argv[index + 1] ?? "")).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail("Provide a valid e-mail address: --email person@example.com");

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: profile, error: profileError } = await supabase.from("profiles").select("id, role").eq("email", email).maybeSingle();
if (profileError) fail(`Could not read the profile: ${profileError.message}`);
if (!profile) fail("No account is registered with this e-mail address.");
if (profile.role !== "staff") fail("This account is not a staff account.");

const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId: profile.id });
if (error) fail(`Could not read the authentication factors: ${error.message}`);
for (const factor of data.factors) {
  const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({ id: factor.id, userId: profile.id });
  if (deleteError) fail(`Could not delete the authentication factor: ${deleteError.message}`);
}
console.log(
  data.factors.length > 0
    ? `Done: two-factor authentication reset for ${email}. The person sets it up again at next sign-in.`
    : `${email} had no authenticator app set up; nothing changed.`,
);
