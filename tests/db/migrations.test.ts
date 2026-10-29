import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  APPLICATION_TYPES,
  APPOINTMENT_SLOTS,
  APPOINTMENT_STATUSES,
  DOCUMENT_REQUIREMENTS,
  FILE_KINDS,
  VISA_OUTCOMES,
  DOCUMENT_REVIEW_STATUSES,
  PAYMENT_STATUSES,
  SPONSOR_STATUSES,
} from "@/lib/domain/constants";
import { FORM_SECTIONS } from "@/features/application-form/definition";
import { rejection, TestDb } from "../helpers/db";

let db: TestDb;
let customer: string;
let appId: string;

beforeAll(async () => {
  db = await TestDb.create();
  customer = await db.createUser("sabitler@example.com", { first_name: "Sabit", last_name: "Test" });
  appId = (await db.admin<{ id: string }>("insert into public.applications (customer_id) values ($1) returning id", [customer]))[0]!.id;
});

afterAll(async () => {
  await db.close();
});

describe("migration files", () => {
  it("apply in order to an empty database without errors", async () => {
    const tables = await db.admin<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public' order by 1");
    expect(tables.map((t) => t.tablename)).toEqual([
      "account_deletion_requests",
      "application_documents",
      "application_fee_items",
      "application_files",
      "application_form_sections",
      "application_messages",
      "application_terms_acceptances",
      "applications",
      "appointment_locations",
      "appointment_preferences",
      "audit_log",
      "cities",
      "customer_tasks",
      "document_rule_items",
      "document_rules",
      "document_types",
      "fee_items",
      "notifications",
      "profiles",
      "risk_assessments",
      "settings",
      "staff_notes",
      "zip_categories",
    ]);
  });

  it("every table in the public schema has RLS enabled", async () => {
    const withoutRls = await db.admin<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(withoutRls).toEqual([]);
  });

  // Supabase opens every new table to the anon and authenticated roles (see tests/helpers/supabase-shim.sql).
  // Since the files are run one by one in the SQL Editor, the intermediate state after the first file must be closed too.
  it("tables are closed even when only the first file is applied", async () => {
    const partial = await TestDb.create({ migrationCount: 1 });
    try {
      const withoutRls = await partial.admin("select tablename from pg_tables where schemaname = 'public' and not rowsecurity");
      expect(withoutRls).toEqual([]);
      const open = await partial.admin<{ role: string; relname: string; priv: string }>(
        `select r.role, c.relname, p.priv
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('anon'), ('authenticated')) as r (role)
         cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p (priv)
         where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r.role, c.oid, p.priv)`,
      );
      expect(open).toEqual([]);
      const message = await rejection(partial.asAnon((s) => s.query("select id from public.applications")));
      expect(message).toMatch(/permission denied/i);
    } finally {
      await partial.close();
    }
  });

  it("if a file is run a second time by accident, the database rejects it or nothing changes", async () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const sql = (name: string) => readFile(path.join(dir, name), "utf8");
    expect(await rejection(db.adminScript(await sql("20261013000100_schema.sql")))).toMatch(/already exists/i);
    expect(await rejection(db.adminScript(await sql("20261013000200_security.sql")))).toMatch(/already exists/i);
    const before = await db.admin("select count(*) from public.document_types");
    // The "conditional" documents in migration 3 hit the constraint from migration 26; since the earlier rows are "on conflict do nothing",
    // nothing changes.
    expect(await rejection(db.adminScript(await sql("20261013000300_reference_data.sql")))).toMatch(/check constraint/i);
    expect(await db.admin("select count(*) from public.document_types")).toEqual(before);
    // Migration 4 only redefines a function; running it again does not change grants or counts.
    const functions = () =>
      db.admin(
        `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`,
      );
    const functionsBefore = await functions();
    await db.adminScript(await sql("20261014000100_optional_fees.sql"));
    expect(await functions()).toEqual(functionsBefore);
    expect(await rejection(db.adminScript(await sql("20261014000200_risk_assessments.sql")))).toMatch(/already exists/i);
    // Migration 6 stops at the column addition on its first statement; function grants do not change.
    expect(await rejection(db.adminScript(await sql("20261014000300_visa_outcome_random_reference.sql")))).toMatch(/already exists/i);
    // Migration 7 also stops at the column addition on its first statement.
    expect(await rejection(db.adminScript(await sql("20261015000100_document_rules.sql")))).toMatch(/already exists/i);
    // Migration 8 stops at the policy creation on its first statement.
    expect(await rejection(db.adminScript(await sql("20261015000200_customer_profile.sql")))).toMatch(/already exists/i);
    // Migration 9 stops at the column addition on its first statement.
    expect(await rejection(db.adminScript(await sql("20261015000300_notifications_dates_accounts.sql")))).toMatch(/already exists/i);
    // Migration 10 only redefines a function; running it again does not change grants or counts.
    await db.adminScript(await sql("20261015000400_appointment_calendar.sql"));
    expect(await functions()).toEqual(functionsBefore);
    // Migration 11 consists of "if not exists" and a function definition; running it again changes nothing.
    await db.adminScript(await sql("20261016000100_message_reads.sql"));
    expect(await functions()).toEqual(functionsBefore);
    // Migration 12 stops at the table creation on its first statement; old status values do not come back either.
    expect(await rejection(db.adminScript(await sql("20261016000200_automatic_status.sql")))).toMatch(/already exists/i);
    expect(await functions()).toEqual(functionsBefore);
    // Migration 13 stops at the column addition on its first statement.
    expect(await rejection(db.adminScript(await sql("20261019000100_drafts_reopen.sql")))).toMatch(/already exists/i);
    expect(await functions()).toEqual(functionsBefore);
    // Migration 14 stops at the column addition on its first statement.
    expect(await rejection(db.adminScript(await sql("20261019000200_reminders_email.sql")))).toMatch(/already exists/i);
    expect(await functions()).toEqual(functionsBefore);
    // Migration 15 stops at the function creation on its first statement.
    expect(await rejection(db.adminScript(await sql("20261020000100_staff_mfa.sql")))).toMatch(/already exists/i);
    expect(await functions()).toEqual(functionsBefore);
    // Migration 16 stops at the function creation on its first statement.
    expect(await rejection(db.adminScript(await sql("20261020000200_retention.sql")))).toMatch(/already exists/i);
    expect(await functions()).toEqual(functionsBefore);
  });

  it("migration 12 moves old status values to the new ones, deletes no rows and recomputes statuses with the new rule", async () => {
    const before12 = await TestDb.create({ migrationCount: 11 });
    try {
      const owner = await before12.createUser("eski-durum@example.com", { first_name: "Eski", last_name: "Durum" });
      const insert = async (status: string, payment: string, appointment: string) =>
        (
          await before12.admin<{ id: string }>(
            `insert into public.applications (customer_id, status, payment_status, appointment_status, form_locked, submitted_at)
             values ($1, $2, $3, $4, true, now()) returning id`,
            [owner, status, payment, appointment],
          )
        )[0]!.id;
      const correctionVerified = await insert("correction_required", "verified", "preferences_submitted");
      const correctionUnpaid = await insert("correction_required", "under_review", "preferences_submitted");
      const lodged = await insert("visa_submitted", "verified", "scheduled");
      const waiting = await insert("awaiting_result", "verified", "booking_in_progress");
      const booking = await insert("documents_complete", "verified", "booking_in_progress");
      const [{ count }] = await before12.admin<{ count: string }>("select count(*) from public.applications");

      await before12.adminScript(await readFile(path.join(process.cwd(), "supabase", "migrations", "20261016000200_automatic_status.sql"), "utf8"));

      const rows = await before12.admin<{ id: string; status: string; appointment_status: string }>("select id, status, appointment_status from public.applications");
      const byId = Object.fromEntries(rows.map((r) => [r.id, `${r.status}/${r.appointment_status}`]));
      expect(rows).toHaveLength(Number(count));
      // If nothing is expected from the customer, the recomputation returns it to review.
      expect(byId[correctionVerified]).toBe("in_review/preferences_submitted");
      expect(byId[correctionUnpaid]).toBe("submitted/preferences_submitted");
      expect(byId[lodged]).toBe("awaiting_result/completed");
      expect(byId[waiting]).toBe("awaiting_result/completed");
      expect(byId[booking]).toBe("documents_complete/preferences_submitted");
      const audit = await before12.admin<{ details: Record<string, unknown> }>(
        "select details from public.audit_log where action = 'application.status_changed' and application_id = $1",
        [correctionVerified],
      );
      expect(audit).toEqual([{ details: { from: "awaiting_customer", to: "in_review", automatic: true } }]);
    } finally {
      await before12.close();
    }
  });

  it("the submission function can only be called by the service role (also after migration 4)", async () => {
    const [row] = await db.admin<{ auth: boolean; anon: boolean; service: boolean }>(
      `select has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'svc_submit_application'`,
    );
    expect(row).toEqual({ auth: false, anon: false, service: true });
  });

  // Migration 26 failed with a constraint error on the first attempt on live with customers present; the file runs in a single
  // transaction, makes writes to the document tables wait until it finishes, and can be run a second time.
  it("migration 26 applies with drafts holding conditional documents and submitted applications; running it again changes nothing", async () => {
    const sql = await readFile(path.join(process.cwd(), "supabase", "migrations", "20261026000100_optional_documents_extra_uploads.sql"), "utf8");
    const statements = sql.replace(/^--.*$/gm, "").trim();
    expect(statements.startsWith("begin;")).toBe(true);
    expect(statements).toMatch(/lock table public\.document_rule_items, public\.document_types, public\.application_documents/);
    expect(statements.endsWith("commit;")).toBe(true);

    const before26 = await TestDb.create({ migrationCount: 25 });
    try {
      const staffId = await before26.createUser("d26@example.com", { first_name: "D", last_name: "D" });
      await before26.admin("update public.profiles set role = 'staff', is_admin = true where id = $1", [staffId]);
      for (let i = 0; i < 3; i++) {
        const owner = await before26.createUser(`m26-${i}@example.com`, { first_name: "M", last_name: String(i) });
        const app = (await before26.asUser(owner, (s) => s.query<{ id: string }>("insert into public.applications (customer_id) values ($1) returning id", [owner])))[0]!.id;
        await before26.asUser(owner, (s) => s.run("update public.applications set application_types = array['student','sponsored'], sponsor_status = 'retired' where id = $1", [app]));
        await before26.asUser(owner, (s) => s.run("select public.sync_application_documents($1)", [app]));
        if (i === 0) continue;
        const conditional = await before26.admin<{ id: string }>("select id from public.application_documents where application_id = $1 and requirement = 'conditional' order by id", [app]);
        await before26.asService((s) => s.run("select public.svc_set_document_not_applicable($1, $2, true, 'yok')", [owner, conditional[0]!.id]));
        await before26.asService(async (s) => {
          await s.run("select public.svc_set_appointment_preferences($1, $2, $3::jsonb)", [owner, app, JSON.stringify([{ date: "2026-10-28", slot: "full_day" }])]);
          await s.run("select public.svc_accept_application_terms($1, $2, '2026-10-23')", [owner, app]);
          await s.run("select public.svc_submit_application($1, $2, '[]'::jsonb)", [owner, app]);
        });
        await before26.asUser(staffId, (s) => s.run("update public.application_documents set review_status = 'missing' where id = $1", [conditional[1]!.id]));
      }
      const counts = () => before26.admin("select requirement, count(*)::int as n from public.application_documents group by 1 order by 1");
      const [conditionalBefore] = await before26.admin<{ n: number }>("select count(*)::int as n from public.application_documents where requirement = 'conditional'");
      expect(conditionalBefore!.n).toBeGreaterThan(0);
      const total = (await before26.admin<{ n: number }>("select count(*)::int as n from public.application_documents"))[0]!.n;

      await before26.adminScript(sql);
      const after = await counts();
      expect(after.map((r) => r.requirement)).toEqual(["optional", "required"]);
      expect(after.reduce((sum, r) => sum + Number(r.n), 0)).toBe(total);
      // The customer's "not applicable" declaration stays in the record; only the permission is closed.
      expect(await before26.admin("select 1 from public.application_documents where allow_not_applicable")).toEqual([]);
      expect((await before26.admin<{ n: number }>("select count(*)::int as n from public.application_documents where not_applicable"))[0]!.n).toBe(2);

      await before26.adminScript(sql);
      expect(await counts()).toEqual(after);
      // Once the later files are applied too, the installation check passes.
      const { readdir } = await import("node:fs/promises");
      const dir = path.join(process.cwd(), "supabase", "migrations");
      for (const name of (await readdir(dir)).filter((n) => n.endsWith(".sql") && n > "20261026000100_optional_documents_extra_uploads.sql").sort()) {
        await before26.adminScript(await readFile(path.join(dir, name), "utf8"));
      }
      const check = await readFile(path.join(process.cwd(), "supabase", "checks", "verify-installation.sql"), "utf8");
      expect((await before26.admin<{ status: string }>(check)).filter((r) => r.status !== "OK")).toEqual([]);
    } finally {
      await before26.close();
    }
  }, 60_000);

  it("every row of the installation check query reads OK", async () => {
    const sql = await readFile(path.join(process.cwd(), "supabase", "checks", "verify-installation.sql"), "utf8");
    const rows = await db.admin<{ no: number; check_name: string; expected: string; actual: string; status: string }>(sql);
    expect(rows).toHaveLength(46);
    expect(rows.filter((r) => r.status !== "OK")).toEqual([]);
  });

  it("the combined installation file for the live project is up to date and applies to an empty database in one go", async () => {
    // supabase/setup/full-installation.sql: generated with node scripts/build-full-installation.mjs.
    const combined = await readFile(path.join(process.cwd(), "supabase", "setup", "full-installation.sql"), "utf8");
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const { readdir } = await import("node:fs/promises");
    let position = -1;
    for (const name of (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort()) {
      const index = combined.indexOf((await readFile(path.join(dir, name), "utf8")).trimEnd());
      expect(index, `${name} birleşik dosyada yok veya güncel değil; scripti yeniden çalıştırın`).toBeGreaterThan(position);
      position = index;
    }
    const fresh = await TestDb.create({ migrationCount: 0 });
    try {
      await fresh.adminScript(combined);
      const check = await readFile(path.join(process.cwd(), "supabase", "checks", "verify-installation.sql"), "utf8");
      const rows = await fresh.admin<{ status: string }>(check);
      expect(rows.filter((r) => r.status !== "OK")).toEqual([]);
    } finally {
      await fresh.close();
    }
  }, 120_000);

  it("the storage bucket is private and only accepts PDF/JPEG/PNG", async () => {
    const [bucket] = await db.admin<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'application-files'",
    );
    expect(bucket!.public).toBe(false);
    expect(Number(bucket!.file_size_limit)).toBe(10 * 1024 * 1024);
    expect(bucket!.allowed_mime_types).toEqual(["application/pdf", "image/jpeg", "image/png"]);
  });

  it("the company's ZIP folder names are loaded with their spelling; no document is mapped in advance", async () => {
    const folders = await db.admin<{ folder_name: string }>("select folder_name from public.zip_categories order by sort_order");
    expect(folders.map((f) => f.folder_name)).toEqual([
      "accomodation",
      "financial evidence",
      "life events",
      "other",
      "pasaport",
      "proof of business",
      "sponsor",
    ]);
    const mapped = await db.admin("select id from public.document_types where zip_category_id is not null");
    expect(mapped).toEqual([]);
  });

  it("contains no made-up values for prices, cities, IBAN or contact details", async () => {
    expect(await db.admin("select id from public.fee_items")).toEqual([]);
    expect(await db.admin("select id from public.cities")).toEqual([]);
    const placeholders = await db.admin<{ key: string; value: unknown }>(
      "select key, value from public.settings where key like 'payment.%' or key like 'company.contact%' order by key",
    );
    for (const row of placeholders.filter((r) => r.key !== "payment.receipt_upload_enabled")) {
      expect(row.value, row.key).toBeNull();
    }
  });

  it("the person-specific erroneous document entry is not in the standard list", async () => {
    const rows = await db.admin<{ label: string }>("select label from public.document_types where label ilike '%oğlunuz%'");
    expect(rows).toEqual([]);
  });

  it("a required document cannot be defined as 'not applicable'", async () => {
    const message = await rejection(
      db.admin("insert into public.document_types (id, label, requirement, allow_not_applicable) values ('x_test', 'X', 'required', true)"),
    );
    expect(message).toMatch(/check constraint/i);
  });

  // The "Koşullu" rule and the "not applicable" declaration were removed in migration 26.
  it("a document rule is only required or optional; the 'not applicable' permission cannot be enabled on any document", async () => {
    for (const [requirement, allow] of [
      ["optional", true],
      ["conditional", false],
      ["conditional", true],
    ] as const) {
      const message = await rejection(
        db.admin("insert into public.document_types (id, label, requirement, allow_not_applicable) values ('x_test', 'X', $1, $2)", [requirement, allow]),
      );
      expect(message, `${requirement}/${allow}`).toMatch(/check constraint/i);
    }
    for (const table of ["document_types", "document_rule_items", "application_documents"]) {
      expect(await db.admin(`select 1 from public.${table} where requirement = 'conditional'`), table).toEqual([]);
    }
    expect(await db.admin("select 1 from public.document_types where allow_not_applicable")).toEqual([]);
    expect(
      await rejection(
        db.admin("insert into public.application_documents (application_id, custom_label, requirement, allow_not_applicable) values ($1, 'X', 'optional', true)", [appId]),
      ),
    ).toMatch(/check constraint/i);
  });

  it("the document list changes from migration 7 are applied", async () => {
    const rows = await db.admin<{ id: string; requirement: string; description: string; is_active: boolean; minors_only: boolean; application_type: string | null }>(
      `select id, requirement, description, is_active, minors_only, application_type from public.document_types
       where id in ('employee_company_letter', 'self_company_letter', 'host_invitation_letter', 'sponsor_letter',
                    'retired_invitation_letter', 'self_invoices_or_z_reports', 'parental_consent') order by id`,
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const id of ["employee_company_letter", "self_company_letter", "host_invitation_letter", "sponsor_letter"]) {
      expect(byId[id], id).toMatchObject({ requirement: "optional", description: "Bu belge tarafımızca hazırlanacaktır.", is_active: true });
    }
    expect(byId.retired_invitation_letter).toMatchObject({ is_active: false });
    expect(byId.self_invoices_or_z_reports).toMatchObject({ requirement: "required", application_type: "self_employed", minors_only: false });
    expect(byId.parental_consent).toMatchObject({
      requirement: "optional",
      application_type: null,
      minors_only: true,
      description: "Bu belge tarafımızca hazırlanacaktır.",
    });
  });

  it("the database rejects unsafe ZIP folder names", async () => {
    for (const name of ["../x", "a/b", "a\\b", "..", ".", " bosluk", "nokta.", ""]) {
      const message = await rejection(db.admin("insert into public.zip_categories (folder_name) values ($1)", [name]));
      expect(message, name).toMatch(/check constraint/i);
    }
  });
});

describe("TypeScript constants match the database constraints", () => {
  it("application statuses", async () => {
    // Leaving the draft state requires acceptance of the application terms of service (migration 24).
    await db.admin(
      "insert into public.application_terms_acceptances (application_id, customer_id, terms_version) select id, customer_id, '2026-10-23' from public.applications where id = $1",
      [appId],
    );
    await db.admin("update public.applications set submitted_at = now(), payment_status = 'verified' where id = $1", [appId]);
    for (const status of APPLICATION_STATUSES) {
      await db.admin("update public.applications set status = $2 where id = $1", [appId, status]);
    }
    expect(await rejection(db.admin("update public.applications set status = 'uydurma' where id = $1", [appId]))).toMatch(/check constraint/i);
  });

  it("payment and appointment statuses", async () => {
    // Since the status follows from the payment (migration 12), every payment status is tried with the application set to "submitted".
    for (const status of PAYMENT_STATUSES) {
      await db.admin("update public.applications set status = 'submitted', payment_status = $2 where id = $1", [appId, status]);
    }
    for (const status of APPOINTMENT_STATUSES) {
      await db.admin("update public.applications set appointment_status = $2 where id = $1", [appId, status]);
    }
  });

  it("file types and visa outcomes", async () => {
    const [kinds] = await db.admin<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'application_files_kind_check'");
    expect([...kinds!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...FILE_KINDS].sort());
    const [outcomes] = await db.admin<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       where c.conrelid = 'public.applications'::regclass and pg_get_constraintdef(c.oid) like '%visa_outcome = ANY%'`,
    );
    expect([...outcomes!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...VISA_OUTCOMES].sort());
  });

  it("application types and sponsor statuses", async () => {
    await db.admin("update public.applications set application_types = $2 where id = $1", [appId, [...APPLICATION_TYPES]]);
    for (const status of SPONSOR_STATUSES) {
      await db.admin("update public.applications set sponsor_status = $2 where id = $1", [appId, status]);
    }
    expect(
      await rejection(db.admin("update public.applications set application_types = array['uydurma'] where id = $1", [appId])),
    ).toMatch(/check constraint/i);
  });

  it("form sections", async () => {
    for (const section of FORM_SECTIONS) {
      await db.admin("insert into public.application_form_sections (application_id, section_id, data) values ($1, $2, '{}')", [appId, section.id]);
    }
    const message = await rejection(
      db.admin("insert into public.application_form_sections (application_id, section_id, data) values ($1, 'uydurma', '{}')", [appId]),
    );
    expect(message).toMatch(/check constraint/i);
  });

  it("document rules, review statuses and appointment time slots", async () => {
    for (const requirement of DOCUMENT_REQUIREMENTS) {
      for (const review of DOCUMENT_REVIEW_STATUSES) {
        await db.admin(
          "insert into public.application_documents (application_id, custom_label, requirement, review_status) values ($1, $2, $3, $4)",
          [appId, `${requirement}-${review}`, requirement, review],
        );
      }
    }
    let rank = 1;
    for (const slot of APPOINTMENT_SLOTS) {
      await db.admin("insert into public.appointment_preferences (application_id, rank, preferred_date, slot) values ($1, $2, '2026-10-20', $3)", [
        appId,
        rank++,
        slot,
      ]);
    }
  });

  it("application type values in document types are limited to the defined types", async () => {
    const rows = await db.admin<{ application_type: string }>(
      "select distinct application_type from public.document_types where application_type is not null",
    );
    for (const row of rows) expect(APPLICATION_TYPES).toContain(row.application_type);
    // At least one document is defined for each of the six application types.
    expect(rows.map((r) => r.application_type).sort()).toEqual([...APPLICATION_TYPES].sort());
  });
});
