// Concatenates all migration files, in order, into one file for a new (production) Supabase project:
// supabase/setup/full-installation.sql. The file is run ONCE in the new project's SQL Editor
// (instead of pasting every file one by one). Regenerate after adding a migration: node scripts/build-full-installation.mjs
// tests/db/migrations.test.ts checks that the file is up to date and applies cleanly to an empty database in one go.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildProductionSetup() {
  const dir = path.join(ROOT, "supabase", "migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const parts = [
    "-- =============================================================================",
    "-- Vize Başvuru Portalı — full installation of the LIVE project (GENERATED FILE, do not edit by hand)",
    "-- =============================================================================",
    `-- ${files.length} migration files in order. Run ONCE in the SQL Editor of an EMPTY, NEW Supabase project ONLY.`,
    "-- Then run supabase/checks/verify-installation.sql: every row must read OK.",
    "-- To regenerate: node scripts/build-full-installation.mjs",
    "",
  ];
  for (const name of files) {
    parts.push(`-- >>> ${name}`, (await readFile(path.join(dir, name), "utf8")).trimEnd(), "");
  }
  return parts.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const target = path.join(ROOT, "supabase", "setup", "full-installation.sql");
  await writeFile(target, await buildProductionSetup(), "utf8");
  console.log(`Written: ${path.relative(ROOT, target)}`);
}
