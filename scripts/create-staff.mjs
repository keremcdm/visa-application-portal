// CREATES THE FIRST STAFF ACCOUNT (or, when explicitly requested, grants staff rights to an existing account).
//
// Staff accounts cannot be created through the public sign-up form. The first consultant account is created with
// this script; later ones are invited from "Ayarlar > Personel" (Settings > Staff) in the admin panel.
//
// Usage:
//   npm run staff:create -- --email consultant@example.com --first-name Ayşe --last-name Yılmaz
//       Sends the person an invitation e-mail to set their password.
//   npm run staff:create -- --email consultant@example.com --existing
//       Grants staff rights to an already registered account (no invitation is sent).
//
// Required environment variables (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, NEXT_PUBLIC_SITE_URL
// This script uses the service role key; it must only be run by an authorized person on a secure machine.
import { existsSync } from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
if (!url || !secretKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");

const email = (argument("email") ?? "").trim().toLowerCase();
const firstName = (argument("first-name") ?? "").trim();
const lastName = (argument("last-name") ?? "").trim();
const existing = process.argv.includes("--existing");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail("Provide a valid e-mail address: --email person@example.com");
if (!existing && (!firstName || !lastName)) fail("Provide a first and last name for a new account: --first-name Ayşe --last-name Yılmaz");

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function grant(userId) {
  const { error } = await supabase.rpc("svc_set_staff_access", {
    p_actor_id: null,
    p_user_id: userId,
    p_role: "staff",
    p_is_active: true,
  });
  if (error) fail(`Personel yetkisi verilemedi: ${error.message}`);
  // This script is only used when nobody can sign in to the panel; the account becomes an admin (migration 18). That
  // admin then invites further staff from Settings → Staff.
  const { error: adminError } = await supabase.rpc("svc_set_staff_admin", { p_actor_id: null, p_user_id: userId, p_is_admin: true });
  if (adminError && adminError.code !== "PGRST202") fail(`Could not grant admin rights: ${adminError.message}`);
}

if (existing) {
  const { data, error } = await supabase.from("profiles").select("id, role").eq("email", email).maybeSingle();
  if (error) fail(`Could not read the profile: ${error.message}`);
  if (!data) fail("No account is registered with this e-mail address.");
  await grant(data.id);
  console.log(`Done: staff rights granted to ${email}.`);
} else {
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { first_name: firstName, last_name: lastName },
    redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error || !data?.user) {
    fail(
      `Could not send the invitation: ${error?.message ?? "unknown error"}. ` +
        "If the account already exists, use the --existing option.",
    );
  }
  await grant(data.user.id);
  console.log(`Done: invitation sent to ${email} and staff rights granted to the account.`);
  console.log("After setting a password through the link in the e-mail, the person can sign in at /sign-in.");
}
