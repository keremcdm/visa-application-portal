import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextApplicationStatus } from "@/features/applications/status-flow";
import { APPLICATION_STATUSES, APPOINTMENT_STATUSES, PAYMENT_STATUSES } from "@/lib/domain/constants";
import { rejection, TestDb, type Session } from "../helpers/db";

/**
 * NEGATIVE ACCESS TESTS
 *
 * The real migration files are loaded into an embedded Postgres and requests run with the
 * `anon` / `authenticated` / `service_role` roles, as PostgREST does. Goal: a customer who bypasses
 * the app server and sends requests DIRECTLY to the database API still cannot access someone else's
 * data or escalate their own permissions.
 */

let db: TestDb;
let alice: string; // customer
let bob: string; // another customer
let staff: string; // active staff member
let exStaff: string; // disabled staff member
let aliceApp: string;
let bobApp: string;

const DENIED = /permission denied|row-level security|protected_column|application_not_editable|forbidden|oluşturulamaz|değiştirilemez/i;

async function createDraft(owner: string): Promise<string> {
  return db.asUser(owner, async (s) => {
    const rows = await s.query<{ id: string }>("insert into public.applications (customer_id) values ($1) returning id", [owner]);
    return rows[0]!.id;
  });
}

async function submit(owner: string, applicationId: string): Promise<void> {
  await db.asService(async (s) => {
    await s.run("select public.svc_set_appointment_preferences($1, $2, $3::jsonb)", [
      owner,
      applicationId,
      JSON.stringify([
        { date: "2026-10-20", slot: "morning" },
        { date: "2026-10-21", slot: "evening" },
        { date: "2026-10-22", slot: "full_day" },
      ]),
    ]);
    // The application terms of service are accepted before submission (migration 24).
    await s.run(ACCEPT_TERMS, [owner, applicationId, TERMS_VERSION]);
    await s.run("select public.svc_submit_application($1, $2, $3::jsonb)", [
      owner,
      applicationId,
      JSON.stringify([{ label: "TEST ücret kalemi", kind: "consultancy", amount: 100, currency: "TRY" }]),
    ]);
  });
}

const ACCEPT_TERMS = "select public.svc_accept_application_terms($1, $2, $3)";
const TERMS_VERSION = "2026-10-23";

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@example.com", { first_name: "Alice", last_name: "Test", birth_date: "1990-05-05", consents_accepted: true });
  bob = await db.createUser("bob@example.com", { first_name: "Bob", last_name: "Test" });
  staff = await db.createUser("danisman@example.com", { first_name: "Danışman", last_name: "Bir" });
  exStaff = await db.createUser("eski-danisman@example.com", { first_name: "Eski", last_name: "Personel" });
  // The main test staff member is an admin (migration 18); staff who are not admins are tested separately.
  await db.makeStaff(staff, true, true);
  await db.makeStaff(exStaff, false);
  aliceApp = await createDraft(alice);
  bobApp = await createDraft(bob);
  await db.asUser(alice, (s) =>
    s.run("insert into public.application_form_sections (application_id, section_id, data) values ($1, 'personal', $2::jsonb)", [
      aliceApp,
      JSON.stringify({ firstName: "Alice", lastName: "Test", tcNo: "10000000146" }),
    ]),
  );
  await db.asUser(bob, (s) =>
    s.run("insert into public.application_form_sections (application_id, section_id, data) values ($1, 'personal', $2::jsonb)", [
      bobApp,
      JSON.stringify({ firstName: "Bob", lastName: "Test", tcNo: "10000000146" }),
    ]),
  );
});

afterAll(async () => {
  await db.close();
});

describe("sign-up and role", () => {
  it("the staff role cannot be obtained through sign-up metadata", async () => {
    const sneaky = await db.createUser("sizma@example.com", { first_name: "S", last_name: "T", role: "staff", is_active: true });
    const [profile] = await db.admin<{ role: string }>("select role from public.profiles where id = $1", [sneaky]);
    expect(profile!.role).toBe("customer");
    const visible = await db.asUser(sneaky, (s) => s.query("select id from public.applications"));
    expect(visible).toEqual([]);
  });

  it("sign-up details are copied to the profile; an invalid date of birth does not block sign-up", async () => {
    const [profile] = await db.admin<{ first_name: string; birth_date: string | null; consents_accepted_at: string | null }>(
      "select first_name, birth_date::text, consents_accepted_at::text from public.profiles where id = $1",
      [alice],
    );
    expect(profile!.first_name).toBe("Alice");
    expect(profile!.birth_date).toBe("1990-05-05");
    expect(profile!.consents_accepted_at).not.toBeNull();

    const odd = await db.createUser("tarih@example.com", { first_name: "T", last_name: "T", birth_date: "tarih-degil" });
    const [oddProfile] = await db.admin<{ birth_date: string | null }>("select birth_date::text from public.profiles where id = $1", [odd]);
    expect(oddProfile!.birth_date).toBeNull();
  });

  it("a customer cannot change their own role", async () => {
    expect(await rejection(db.asUser(alice, (s) => s.run("update public.profiles set role = 'staff' where id = $1", [alice])))).toMatch(DENIED);
    expect(await rejection(db.asUser(alice, (s) => s.run("insert into public.profiles (id, email, role) values ($1, 'x@example.com', 'staff')", [alice])))).toMatch(
      DENIED,
    );
  });

  it("a customer sees only their own profile; staff see all", async () => {
    const own = await db.asUser(alice, (s) => s.query<{ id: string }>("select id from public.profiles"));
    expect(own.map((r) => r.id)).toEqual([alice]);
    const all = await db.asUser(staff, (s) => s.query("select id from public.profiles"));
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it("a customer cannot call service role functions", async () => {
    const calls = [
      ["select public.svc_set_staff_access($1, $1, 'staff', true)", [alice]],
      ["select public.svc_submit_application($1, $2, '[]'::jsonb)", [alice, aliceApp]],
      ["select public.svc_declare_payment($1, $2)", [alice, aliceApp]],
      ["select public.svc_delete_file($1, $2)", [alice, aliceApp]],
      ["select private.write_audit($1, 'x.y', null, null, null, '{}'::jsonb)", [alice]],
      ["select private.complete_past_appointments()", []],
      ["select private.sync_application_status($1)", [aliceApp]],
      ["select * from public.svc_claim_notification_emails(10)", []],
      ["select public.svc_finish_notification_email($1, true, null)", [aliceApp]],
      ["select public.svc_record_staff_security_event($1, 'staff.mfa_reset', $1)", [alice]],
      ["select * from public.svc_expired_applications(10)", []],
      ["select public.svc_delete_expired_application($1)", [aliceApp]],
    ] as const;
    for (const [sql, params] of calls) {
      expect(await rejection(db.asUser(alice, (s) => s.run(sql, [...params]))), sql).toMatch(/permission denied/i);
    }
  });

  it("functions callable through the API are limited to a known short list", async () => {
    const callable = async (role: string) =>
      (
        await db.admin<{ proname: string }>(
          `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1`,
          [role],
        )
      ).map((r) => r.proname);
    expect(await callable("anon")).toEqual([]);
    // If you add a new function, update this list DELIBERATELY.
    expect(await callable("authenticated")).toEqual([
      "application_status_history",
      "delete_document_type",
      "mark_message_read",
      "record_staff_event",
      "save_document_rule",
      "sync_application_documents",
    ]);
  });

  it("staff cannot remove their own rights; permission changes are written to the audit log", async () => {
    expect(await rejection(db.asService((s) => s.run("select public.svc_set_staff_access($1, $1, 'customer', true)", [staff])))).toMatch(
      /cannot_change_own_access/,
    );
    const temp = await db.createUser("yeni-personel@example.com", { first_name: "Yeni", last_name: "Personel" });
    await db.asService((s) => s.run("select public.svc_set_staff_access($1, $2, 'staff', true)", [staff, temp]));
    const [audit] = await db.admin<{ actor_id: string; details: { role_to: string } }>(
      "select actor_id, details from public.audit_log where action = 'staff.access_changed' and entity_id = $1",
      [temp],
    );
    expect(audit!.actor_id).toBe(staff);
    expect(audit!.details.role_to).toBe("staff");
  });
});

describe("the customer's own profile", () => {
  it("a customer can correct their first name, last name and date of birth", async () => {
    const changed = await db.asUser(alice, (s) =>
      s.run("update public.profiles set first_name = 'Alicia', last_name = 'Testoğlu', birth_date = '1991-02-03' where id = $1", [alice]),
    );
    expect(changed).toBe(1);
    const [row] = await db.admin<{ first_name: string; last_name: string; birth_date: string }>(
      "select first_name, last_name, birth_date::text from public.profiles where id = $1",
      [alice],
    );
    expect(row).toEqual({ first_name: "Alicia", last_name: "Testoğlu", birth_date: "1991-02-03" });
  });

  it("a customer cannot change their role, account status or e-mail", async () => {
    for (const set of ["role = 'staff'", "is_active = false", "email = 'sahte@example.com'", "consents_accepted_at = now()"]) {
      expect(await rejection(db.asUser(alice, (s) => s.run(`update public.profiles set ${set} where id = $1`, [alice]))), set).toMatch(/permission denied/i);
    }
    const [row] = await db.admin<{ role: string; is_active: boolean }>("select role, is_active from public.profiles where id = $1", [alice]);
    expect(row).toEqual({ role: "customer", is_active: true });
  });

  it("a customer cannot change another user's profile; an anonymous visitor cannot change any profile", async () => {
    expect(await db.asUser(alice, (s) => s.run("update public.profiles set first_name = 'Sahte' where id = $1", [bob]))).toBe(0);
    expect(await db.asUser(alice, (s) => s.run("update public.profiles set first_name = 'Sahte' where id = $1", [staff]))).toBe(0);
    expect(await rejection(db.asAnon((s) => s.run("update public.profiles set first_name = 'Sahte' where id = $1", [alice])))).toMatch(/permission denied/i);
    const names = await db.admin<{ first_name: string }>("select first_name from public.profiles where id = any($1::uuid[])", [[bob, staff]]);
    expect(names.some((r) => r.first_name === "Sahte")).toBe(false);
  });

  it("profile rows cannot be inserted or deleted", async () => {
    expect(await rejection(db.asUser(alice, (s) => s.run("delete from public.profiles where id = $1", [alice])))).toMatch(/permission denied/i);
    expect(
      await rejection(db.asUser(alice, (s) => s.run("insert into public.profiles (id, email) values ('99999999-9999-4999-8999-999999999999', 'x@example.com')"))),
    ).toMatch(/permission denied/i);
  });
});

describe("anonymous visitor", () => {
  it("cannot access any application data", async () => {
    for (const table of [
      "applications",
      "profiles",
      "application_form_sections",
      "application_documents",
      "application_files",
      "application_messages",
      "staff_notes",
      "audit_log",
      "appointment_preferences",
      "notifications",
      "document_types",
      "fee_items",
      "appointment_locations",
    ]) {
      expect(await rejection(db.asAnon((s) => s.query(`select * from public.${table}`))), table).toMatch(/permission denied/i);
    }
  });

  it("sees only public settings", async () => {
    const rows = await db.asAnon((s) => s.query<{ key: string }>("select key from public.settings order by key"));
    expect(rows.map((r) => r.key)).toEqual(["company.contact_email", "company.contact_phone", "company.name"]);
  });

  it("cannot see files in storage", async () => {
    await db.admin("insert into storage.objects (bucket_id, name) values ('application-files', $1)", [`${aliceApp}/anon-test.pdf`]);
    expect(await db.asAnon((s) => s.query("select name from storage.objects"))).toEqual([]);
  });
});

describe("application access", () => {
  it("a customer cannot see another customer's application or its related records", async () => {
    await db.admin("insert into public.application_messages (application_id, author_id, body) values ($1, $2, 'Bob için mesaj')", [bobApp, staff]);
    await db.admin("insert into public.customer_tasks (application_id, title, created_by) values ($1, 'Bob görevi', $2)", [bobApp, staff]);
    await db.admin("insert into public.application_fee_items (application_id, label, kind, amount, currency) values ($1, 'TEST', 'other', 1, 'TRY')", [bobApp]);
    await db.admin("insert into public.appointment_preferences (application_id, rank, preferred_date, slot) values ($1, 1, '2026-10-20', 'morning')", [bobApp]);
    await db.admin("insert into public.application_documents (application_id, custom_label) values ($1, 'Bob belgesi')", [bobApp]);

    for (const table of [
      "applications",
      "application_form_sections",
      "application_messages",
      "customer_tasks",
      "application_fee_items",
      "appointment_preferences",
      "application_documents",
      "application_overview",
    ]) {
      const column = table === "applications" || table === "application_overview" ? "id" : "application_id";
      const rows = await db.asUser(alice, (s) => s.query(`select * from public.${table} where ${column} = $1`, [bobApp]));
      expect(rows, table).toEqual([]);
    }
    // Counter-check: Bob sees his own records.
    const own = await db.asUser(bob, (s) => s.query("select id from public.application_messages where application_id = $1", [bobApp]));
    expect(own).toHaveLength(1);
  });

  it("a customer cannot create an application on someone else's behalf", async () => {
    expect(await rejection(db.asUser(alice, (s) => s.run("insert into public.applications (customer_id) values ($1)", [bob])))).toMatch(DENIED);
  });

  it("status/payment values a customer sends when creating an application are ignored", async () => {
    const [row] = await db.asUser(alice, (s) =>
      s.query<{ status: string; payment_status: string; form_locked: boolean; reference_code: string; submitted_at: string | null }>(
        `insert into public.applications (customer_id, status, payment_status, form_locked, reference_code, submitted_at, appointment_status)
         values ($1, 'in_review', 'verified', true, 'SAHTE-KOD', now(), 'scheduled')
         returning status, payment_status, form_locked, reference_code, submitted_at`,
        [alice],
      ),
    );
    expect(row).toMatchObject({ status: "draft", payment_status: "not_due", form_locked: false, submitted_at: null });
    expect(row!.reference_code).toMatch(/^VB-\d{4}-\d{6}$/);
  });

  it("a customer cannot update or delete someone else's application", async () => {
    const updated = await db.asUser(alice, (s) => s.run("update public.applications set application_types = array['student'] where id = $1", [bobApp]));
    expect(updated).toBe(0);
    expect(await rejection(db.asUser(alice, (s) => s.run("delete from public.applications where id = $1", [bobApp])))).toMatch(DENIED);
    expect(await rejection(db.asUser(alice, (s) => s.run("delete from public.applications where id = $1", [aliceApp])))).toMatch(DENIED);
  });

  it("a customer can change the type of their own draft but not the status, payment or appointment fields", async () => {
    const ok = await db.asUser(alice, (s) =>
      s.run("update public.applications set application_types = array['student', 'sponsored'], sponsor_status = 'employee' where id = $1", [aliceApp]),
    );
    expect(ok).toBe(1);
    const attempts = [
      "status = 'in_review'",
      "status = 'submitted'",
      "payment_status = 'verified'",
      "form_locked = true",
      "appointment_status = 'scheduled'",
      "appointment_at = now()",
      "payment_note = 'x'",
      "submitted_at = now()",
      "payment_reviewed_by = customer_id",
      "customer_id = customer_id, reference_code = 'X'",
    ];
    for (const set of attempts) {
      expect(await rejection(db.asUser(alice, (s) => s.run(`update public.applications set ${set} where id = $1`, [aliceApp]))), set).toMatch(DENIED);
    }
    const [row] = await db.admin<{ status: string; payment_status: string }>("select status, payment_status from public.applications where id = $1", [aliceApp]);
    expect(row).toEqual({ status: "draft", payment_status: "not_due" });
  });

  it("at most 5 drafts can be open at the same time", async () => {
    const carol = await db.createUser("carol@example.com", { first_name: "Carol", last_name: "Test" });
    for (let i = 0; i < 5; i++) await createDraft(carol);
    expect(await rejection(createDraft(carol))).toMatch(/draft_limit_reached/);
  });

  it("disabled staff are treated like customers", async () => {
    expect(await db.asUser(exStaff, (s) => s.query("select id from public.applications"))).toEqual([]);
    expect(await db.asUser(exStaff, (s) => s.query("select id from public.staff_notes"))).toEqual([]);
    expect(await db.asUser(exStaff, (s) => s.query("select id from public.audit_log"))).toEqual([]);
    expect(await db.asUser(exStaff, (s) => s.run("update public.document_types set requirement = 'optional'"))).toBe(0);
    expect(await rejection(db.asUser(exStaff, (s) => s.run("select public.record_staff_event('export.zip', $1, '{}'::jsonb)", [aliceApp])))).toMatch(/forbidden/);
    const changed = await db.asUser(exStaff, (s) => s.run("update public.applications set status = 'cancelled' where id = $1", [aliceApp]));
    expect(changed).toBe(0);
  });
});

describe("form answers", () => {
  it("a customer cannot write or read form data on someone else's application", async () => {
    expect(
      await rejection(
        db.asUser(alice, (s) => s.run("insert into public.application_form_sections (application_id, section_id, data) values ($1, 'contact', '{}')", [bobApp])),
      ),
    ).toMatch(DENIED);
    const changed = await db.asUser(alice, (s) =>
      s.run("update public.application_form_sections set data = '{\"firstName\":\"HACK\"}' where application_id = $1", [bobApp]),
    );
    expect(changed).toBe(0);
    const [row] = await db.admin<{ data: { firstName: string } }>(
      "select data from public.application_form_sections where application_id = $1 and section_id = 'personal'",
      [bobApp],
    );
    expect(row!.data.firstName).toBe("Bob");
  });

  it("form data that is too large or not an object is rejected", async () => {
    const huge = JSON.stringify({ notes: "x".repeat(70000) });
    expect(
      await rejection(
        db.asUser(alice, (s) => s.run("insert into public.application_form_sections (application_id, section_id, data) values ($1, 'additional', $2::jsonb)", [aliceApp, huge])),
      ),
    ).toMatch(/check constraint/i);
    expect(
      await rejection(
        db.asUser(alice, (s) => s.run("insert into public.application_form_sections (application_id, section_id, data) values ($1, 'additional', '[1,2]'::jsonb)", [aliceApp])),
      ),
    ).toMatch(/check constraint/i);
  });
});

describe("submission, lock and payment", () => {
  let app: string;
  let dave: string;

  beforeAll(async () => {
    dave = await db.createUser("dave@example.com", { first_name: "Dave", last_name: "Test" });
    app = await createDraft(dave);
    await db.asUser(dave, (s) =>
      s.run("insert into public.application_form_sections (application_id, section_id, data) values ($1, 'personal', '{\"firstName\":\"Dave\"}')", [app]),
    );
  });

  it("cannot be submitted without an appointment preference; the fee list must be an array", async () => {
    const fees = JSON.stringify([{ label: "TEST", kind: "consultancy", amount: 1, currency: "TRY" }]);
    expect(await rejection(db.asService((s) => s.run("select public.svc_submit_application($1, $2, $3::jsonb)", [dave, app, fees])))).toMatch(
      /appointment_preferences_missing/,
    );
    // An empty fee list is no longer a blocker on its own; the same order of checks continues.
    expect(await rejection(db.asService((s) => s.run("select public.svc_submit_application($1, $2, '[]'::jsonb)", [dave, app])))).toMatch(
      /appointment_preferences_missing/,
    );
    expect(await rejection(db.asService((s) => s.run("select public.svc_submit_application($1, $2, '{}'::jsonb)", [dave, app])))).toMatch(/fees_invalid/);
    expect(await rejection(db.asService((s) => s.run("select public.svc_submit_application($1, $2, null::jsonb)", [dave, app])))).toMatch(/fees_invalid/);
  });

  it("submission without a fee breakdown: statuses are set, no fee row is written", async () => {
    const nofee = await db.createUser("ucretsiz-gonderim@example.com", { first_name: "Ücretsiz", last_name: "Test" });
    const nofeeApp = await createDraft(nofee);
    await db.asService(async (s) => {
      await s.run("select public.svc_set_appointment_preferences($1, $2, $3::jsonb)", [
        nofee,
        nofeeApp,
        JSON.stringify([
          { date: "2026-10-20", slot: "morning" },
          { date: "2026-10-21", slot: "evening" },
          { date: "2026-10-22", slot: "morning" },
        ]),
      ]);
      await s.run(ACCEPT_TERMS, [nofee, nofeeApp, TERMS_VERSION]);
      await s.run("select public.svc_submit_application($1, $2, '[]'::jsonb)", [nofee, nofeeApp]);
    });
    const [row] = await db.admin<Record<string, unknown>>(
      "select status, form_locked, payment_status, fees_snapshot_at is null as no_snapshot from public.applications where id = $1",
      [nofeeApp],
    );
    expect(row).toEqual({ status: "submitted", form_locked: true, payment_status: "awaiting_payment", no_snapshot: true });
    expect(await db.admin("select id from public.application_fee_items where application_id = $1", [nofeeApp])).toEqual([]);
    // Submitting with an empty list on someone else's behalf is rejected too.
    const other = await createDraft(nofee);
    expect(await rejection(db.asService((s) => s.run("select public.svc_submit_application($1, $2, '[]'::jsonb)", [alice, other])))).toMatch(/forbidden/);
  });

  it("the same day cannot be preferred twice (even with a different time slot); there must be 1–3 preferences", async () => {
    for (const second of ["morning", "evening"]) {
      const duplicate = JSON.stringify([
        { date: "2026-10-20", slot: "morning" },
        { date: "2026-10-20", slot: second },
        { date: "2026-10-21", slot: "evening" },
      ]);
      expect(
        await rejection(db.asService((s) => s.run("select public.svc_set_appointment_preferences($1, $2, $3::jsonb)", [dave, app, duplicate]))),
        second,
      ).toMatch(/duplicate_preference_date/);
    }
    // Migration 20: at least 1, at most 3 preferences.
    const four = JSON.stringify(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].map((date) => ({ date, slot: "morning" })));
    expect(await rejection(db.asService((s) => s.run("select public.svc_set_appointment_preferences($1, $2, $3::jsonb)", [dave, app, four])))).toMatch(
      /one_to_three_preferences_required/,
    );
    expect(await rejection(db.asService((s) => s.run("select public.svc_set_appointment_preferences($1, $2, '[]'::jsonb)", [dave, app])))).toMatch(
      /one_to_three_preferences_required/,
    );
    expect(await db.admin("select id from public.appointment_preferences where application_id = $1", [app])).toEqual([]);
    const one = JSON.stringify([{ date: "2026-10-20", slot: "morning" }]);
    await db.asService((s) => s.run("select public.svc_set_appointment_preferences($1, $2, $3::jsonb)", [dave, app, one]));
    expect(await db.admin("select rank from public.appointment_preferences where application_id = $1", [app])).toEqual([{ rank: 1 }]);
    await db.admin("delete from public.appointment_preferences where application_id = $1", [app]);
  });

  it("submission on someone else's behalf is rejected", async () => {
    const fees = JSON.stringify([{ label: "TEST", kind: "consultancy", amount: 1, currency: "TRY" }]);
    expect(await rejection(db.asService((s) => s.run("select public.svc_submit_application($1, $2, $3::jsonb)", [alice, app, fees])))).toMatch(/forbidden/);
  });

  it("submission sets the statuses correctly and stores the fee breakdown", async () => {
    await submit(dave, app);
    const [row] = await db.admin<Record<string, unknown>>(
      "select status, form_locked, payment_status, appointment_status, submitted_at is not null as submitted from public.applications where id = $1",
      [app],
    );
    expect(row).toEqual({ status: "submitted", form_locked: true, payment_status: "awaiting_payment", appointment_status: "preferences_submitted", submitted: true });
    const fees = await db.asUser(dave, (s) => s.query("select label from public.application_fee_items where application_id = $1", [app]));
    expect(fees).toHaveLength(1);
    expect(await rejection(submit(dave, app))).toMatch(/preferences_not_editable|already_submitted/);
  });

  it("after submission the customer cannot change the form, the application type or the fee breakdown", async () => {
    expect(await rejection(db.asUser(dave, (s) => s.run("update public.applications set application_types = array['retired'] where id = $1", [app])))).toMatch(DENIED);
    const changed = await db.asUser(dave, (s) =>
      s.run("update public.application_form_sections set data = '{\"firstName\":\"Degisti\"}' where application_id = $1", [app]),
    );
    expect(changed).toBe(0);
    expect(
      await rejection(
        db.asUser(dave, (s) => s.run("insert into public.application_form_sections (application_id, section_id, data) values ($1, 'contact', '{}')", [app])),
      ),
    ).toMatch(DENIED);
    expect(await rejection(db.asUser(dave, (s) => s.run("update public.application_fee_items set amount = 0 where application_id = $1", [app])))).toMatch(DENIED);
    expect(await rejection(db.asUser(dave, (s) => s.run("delete from public.appointment_preferences where application_id = $1", [app])))).toMatch(DENIED);
  });

  it("the customer's payment notice does not verify the payment", async () => {
    await db.asService((s) => s.run("select public.svc_declare_payment($1, $2)", [dave, app]));
    const [row] = await db.admin<{ payment_status: string; payment_reviewed_by: string | null }>(
      "select payment_status, payment_reviewed_by from public.applications where id = $1",
      [app],
    );
    expect(row).toEqual({ payment_status: "under_review", payment_reviewed_by: null });
    expect(await rejection(db.asUser(dave, (s) => s.run("update public.applications set payment_status = 'verified' where id = $1", [app])))).toMatch(DENIED);
    // Cannot be reported twice (already in the check queue).
    expect(await rejection(db.asService((s) => s.run("select public.svc_declare_payment($1, $2)", [dave, app])))).toMatch(/payment_not_expected/);
  });

  it("an application cannot move to review before the payment is verified; staff cannot pick the status by hand", async () => {
    const later = ["in_review", "awaiting_customer", "documents_complete", "awaiting_result", "result_communicated"];
    for (const status of later) {
      expect(await rejection(db.asUser(staff, (s) => s.run("update public.applications set status = $2 where id = $1", [app, status]))), status).toMatch(
        /payment_not_verified|status_change_not_allowed/,
      );
      // Not even the service role can bypass this rule.
      expect(await rejection(db.asService((s) => s.run("update public.applications set status = $2 where id = $1", [app, status]))), status).toMatch(
        /payment_not_verified/,
      );
    }
  });

  it("staff verify the payment; verifier and time are stamped on the server and an audit entry is created", async () => {
    await db.asUser(staff, (s) =>
      // The client cannot name someone else as the "verifier": there is no column grant, and the trigger overwrites it.
      s.run("update public.applications set payment_status = 'verified' where id = $1", [app]),
    );
    const [row] = await db.admin<{ payment_reviewed_by: string; reviewed: boolean }>(
      "select payment_reviewed_by, payment_reviewed_at is not null as reviewed from public.applications where id = $1",
      [app],
    );
    expect(row).toEqual({ payment_reviewed_by: staff, reviewed: true });
    await db.asUser(staff, (s) => s.run("update public.applications set status = 'in_review' where id = $1", [app]));
    const audit = await db.admin<{ action: string; actor_id: string }>(
      "select action, actor_id from public.audit_log where application_id = $1 order by id",
      [app],
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["application.submitted", "payment.declared_by_customer", "payment.status_changed", "application.status_changed"]),
    );
    expect(audit.find((a) => a.action === "payment.status_changed")!.actor_id).toBe(staff);
    expect(await rejection(db.asUser(staff, (s) => s.run("update public.applications set payment_reviewed_by = $2 where id = $1", [app, dave])))).toMatch(
      /permission denied/i,
    );
  });

  it("when payment verification is undone the application cannot be left at a later stage", async () => {
    expect(await rejection(db.asUser(staff, (s) => s.run("update public.applications set payment_status = 'rejected' where id = $1", [app])))).toMatch(
      /payment_not_verified/,
    );
  });

  it("staff cannot turn a submitted application back into a draft", async () => {
    expect(await rejection(db.asUser(staff, (s) => s.run("update public.applications set status = 'draft' where id = $1", [app])))).toMatch(/taslağa döndürülemez/);
  });

  it("if the consultant reopens the form the customer can edit it; the application waits on the customer by itself", async () => {
    await db.asUser(staff, (s) => s.run("update public.applications set form_locked = false where id = $1", [app]));
    expect(await db.admin("select status from public.applications where id = $1", [app])).toEqual([{ status: "awaiting_customer" }]);
    const changed = await db.asUser(dave, (s) =>
      s.run("update public.application_form_sections set data = '{\"firstName\":\"Duzeltildi\"}' where application_id = $1 and section_id = 'personal'", [app]),
    );
    expect(changed).toBe(1);
    // Even with the form open, the status fields are closed to the customer.
    expect(await rejection(db.asUser(dave, (s) => s.run("update public.applications set form_locked = true where id = $1", [app])))).toMatch(DENIED);
  });
});

describe("messages, internal notes and tasks", () => {
  it("internal notes are never visible to the customer", async () => {
    await db.asUser(staff, (s) => s.run("insert into public.staff_notes (application_id, author_id, body) values ($1, $2, 'GİZLİ İÇ NOT')", [aliceApp, staff]));
    expect(await db.asUser(alice, (s) => s.query("select body from public.staff_notes"))).toEqual([]);
    expect(await db.asUser(alice, (s) => s.query("select body from public.staff_notes where application_id = $1", [aliceApp]))).toEqual([]);
    expect(await db.asUser(staff, (s) => s.query("select body from public.staff_notes where application_id = $1", [aliceApp]))).toHaveLength(1);
  });

  it("a customer cannot add internal notes or messages; messages cannot be changed", async () => {
    expect(
      await rejection(db.asUser(alice, (s) => s.run("insert into public.staff_notes (application_id, author_id, body) values ($1, $2, 'x')", [aliceApp, alice]))),
    ).toMatch(DENIED);
    expect(
      await rejection(
        db.asUser(alice, (s) => s.run("insert into public.application_messages (application_id, author_id, body) values ($1, $2, 'x')", [aliceApp, alice])),
      ),
    ).toMatch(DENIED);
    await db.asUser(staff, (s) =>
      s.run("insert into public.application_messages (application_id, author_id, body) values ($1, $2, 'Belgeniz inceleniyor.')", [aliceApp, staff]),
    );
    expect(await db.asUser(alice, (s) => s.query("select body from public.application_messages where application_id = $1", [aliceApp]))).toHaveLength(1);
    expect(await rejection(db.asUser(staff, (s) => s.run("update public.application_messages set body = 'değişti' where application_id = $1", [aliceApp])))).toMatch(
      /permission denied/i,
    );
    expect(await rejection(db.asUser(staff, (s) => s.run("delete from public.application_messages where application_id = $1", [aliceApp])))).toMatch(
      /permission denied/i,
    );
  });

  it("a customer only marks messages in their own application as read; cannot touch the text or mark someone else's message", async () => {
    const [own] = await db.asUser(staff, (s) =>
      s.query<{ id: string }>("insert into public.application_messages (application_id, author_id, body) values ($1, $2, 'Okundu denemesi') returning id", [
        aliceApp,
        staff,
      ]),
    );
    const [other] = await db.asUser(staff, (s) =>
      s.query<{ id: string }>("insert into public.application_messages (application_id, author_id, body) values ($1, $2, 'Bob için') returning id", [bobApp, staff]),
    );
    // Someone else's message: not marked, leaves no trace.
    expect(await db.asUser(alice, (s) => s.query<{ ok: boolean }>("select public.mark_message_read($1) as ok", [other!.id]))).toEqual([{ ok: false }]);
    expect(await db.admin("select id from public.application_messages where id = $1 and customer_read_at is not null", [other!.id])).toEqual([]);
    // Own message: becomes read; a second call does not change the time.
    expect(await db.asUser(alice, (s) => s.query<{ ok: boolean }>("select public.mark_message_read($1) as ok", [own!.id]))).toEqual([{ ok: true }]);
    const [first] = await db.admin<{ at: string }>("select customer_read_at::text as at from public.application_messages where id = $1", [own!.id]);
    expect(first!.at).not.toBeNull();
    await db.asUser(alice, (s) => s.query("select public.mark_message_read($1)", [own!.id]));
    const [second] = await db.admin<{ at: string }>("select customer_read_at::text as at from public.application_messages where id = $1", [own!.id]);
    expect(second!.at).toBe(first!.at);
    // The direct write path is closed: neither the read time nor the text can be changed.
    expect(
      await rejection(db.asUser(alice, (s) => s.run("update public.application_messages set customer_read_at = null, body = 'x' where id = $1", [own!.id]))),
    ).toMatch(/permission denied/i);
    // An anonymous visitor cannot call the function.
    expect(await rejection(db.asAnon((s) => s.query("select public.mark_message_read($1)", [own!.id])))).toMatch(/permission denied/i);
  });

  it("staff cannot write a message on someone else's behalf", async () => {
    expect(
      await rejection(
        db.asUser(staff, (s) => s.run("insert into public.application_messages (application_id, author_id, body) values ($1, $2, 'sahte')", [aliceApp, alice])),
      ),
    ).toMatch(DENIED);
  });

  it("a customer cannot create/change tasks; they only complete their own task through the server", async () => {
    const [task] = await db.asUser(staff, (s) =>
      s.query<{ id: string }>("insert into public.customer_tasks (application_id, title, created_by) values ($1, 'Bizi arayın', $2) returning id", [aliceApp, staff]),
    );
    expect(await rejection(db.asUser(alice, (s) => s.run("insert into public.customer_tasks (application_id, title) values ($1, 'x')", [aliceApp])))).toMatch(DENIED);
    expect(await db.asUser(alice, (s) => s.run("update public.customer_tasks set status = 'cancelled' where id = $1", [task!.id]))).toBe(0);
    expect(await rejection(db.asService((s) => s.run("select public.svc_complete_task($1, $2)", [bob, task!.id])))).toMatch(/forbidden/);
    await db.asService((s) => s.run("select public.svc_complete_task($1, $2)", [alice, task!.id]));
    const [row] = await db.admin<{ status: string; completed_by: string }>("select status, completed_by from public.customer_tasks where id = $1", [task!.id]);
    expect(row).toEqual({ status: "completed", completed_by: alice });
  });

  it("notifications are personal; a customer can only change the read state", async () => {
    await db.asUser(staff, (s) =>
      s.run("insert into public.notifications (user_id, application_id, kind, title) values ($1, $2, 'message.new', 'Yeni mesaj')", [alice, aliceApp]),
    );
    await db.asUser(staff, (s) =>
      s.run("insert into public.notifications (user_id, application_id, kind, title) values ($1, $2, 'message.new', 'Bob için')", [bob, bobApp]),
    );
    const mine = await db.asUser(alice, (s) => s.query<{ title: string }>("select title from public.notifications"));
    expect(mine.map((n) => n.title)).toEqual(["Yeni mesaj"]);
    expect(await db.asUser(alice, (s) => s.run("update public.notifications set read_at = now()"))).toBe(1);
    expect(await rejection(db.asUser(alice, (s) => s.run("update public.notifications set title = 'x'")))).toMatch(/permission denied/i);
    expect(
      await rejection(db.asUser(alice, (s) => s.run("insert into public.notifications (user_id, kind, title) values ($1, 'x.y', 'sahte')", [bob]))),
    ).toMatch(DENIED);
  });
});

describe("documents and files", () => {
  let app: string;
  let erin: string;
  let passportDoc: string;
  // The marriage certificate was conditional until migration 26; it is now optional.
  let marriageDoc: string;

  beforeAll(async () => {
    erin = await db.createUser("erin@example.com", { first_name: "Erin", last_name: "Test" });
    app = await createDraft(erin);
    await db.asUser(erin, (s) => s.run("update public.applications set application_types = array['student'] where id = $1", [app]));
    await db.asUser(erin, (s) => s.run("select public.sync_application_documents($1)", [app]));
    const docs = await db.admin<{ id: string; document_type_id: string }>("select id, document_type_id from public.application_documents where application_id = $1", [app]);
    passportDoc = docs.find((d) => d.document_type_id === "passport")!.id;
    marriageDoc = docs.find((d) => d.document_type_id === "marriage_certificate")!.id;
  });

  it("shared and type-specific document slots are created for the application type", async () => {
    const docs = await db.asUser(erin, (s) => s.query<{ document_type_id: string }>("select document_type_id from public.application_documents where application_id = $1", [app]));
    const ids = docs.map((d) => d.document_type_id);
    expect(ids).toEqual(expect.arrayContaining(["passport", "bank_statement", "student_certificate", "student_transcript", "student_school_letter"]));
    expect(ids).not.toContain("employee_payslips");
    expect(ids).not.toContain("sponsor_letter");
  });

  it("a sponsored application requires extra documents depending on the sponsor's status", async () => {
    await db.asUser(erin, (s) => s.run("update public.applications set application_types = array['student', 'sponsored'], sponsor_status = 'retired' where id = $1", [app]));
    await db.asUser(erin, (s) => s.run("select public.sync_application_documents($1)", [app]));
    const ids = (await db.admin<{ document_type_id: string }>("select document_type_id from public.application_documents where application_id = $1", [app])).map(
      (d) => d.document_type_id,
    );
    expect(ids).toEqual(expect.arrayContaining(["sponsor_letter", "sponsor_bank_statement", "sponsor_retirement_certificate", "student_certificate"]));
    expect(ids).not.toContain("sponsor_payslips");
    expect(ids).not.toContain("sponsor_tax_certificate");
  });

  it("when the type changes, slots without files are removed and slots with files are kept", async () => {
    const [studentDoc] = await db.admin<{ id: string }>(
      "select id from public.application_documents where application_id = $1 and document_type_id = 'student_transcript'",
      [app],
    );
    const fileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.asService((s) =>
      s.run(
        `insert into public.application_files (id, application_id, application_document_id, kind, storage_path, original_name, mime_type, size_bytes, status, uploaded_by)
         values ($1, $2, $3, 'document', $4, 'transkript.pdf', 'application/pdf', 100, 'ready', $5)`,
        [fileId, app, studentDoc!.id, `${app}/${fileId}.pdf`, erin],
      ),
    );
    await db.asUser(erin, (s) => s.run("update public.applications set application_types = array['retired'], sponsor_status = null where id = $1", [app]));
    await db.asUser(erin, (s) => s.run("select public.sync_application_documents($1)", [app]));
    const docs = await db.admin<{ document_type_id: string; out_of_scope: boolean }>(
      "select document_type_id, out_of_scope from public.application_documents where application_id = $1",
      [app],
    );
    expect(docs.find((d) => d.document_type_id === "student_certificate")).toBeUndefined();
    expect(docs.find((d) => d.document_type_id === "student_transcript")).toMatchObject({ out_of_scope: true });
    expect(docs.find((d) => d.document_type_id === "retired_certificate")).toMatchObject({ out_of_scope: false });
    // An invitation letter is no longer required from retired applicants.
    expect(docs.find((d) => d.document_type_id === "retired_invitation_letter")).toBeUndefined();
    expect(await db.admin("select id from public.application_files where id = $1", [fileId])).toHaveLength(1);
  });

  it("the parental consent letter is only required from applicants under 18 according to the date of birth in the form", async () => {
    const minorApp = await createDraft(erin);
    await db.asUser(erin, (s) => s.run("update public.applications set application_types = array['self_employed'] where id = $1", [minorApp]));
    const slotIds = async () =>
      (await db.admin<{ document_type_id: string }>("select document_type_id from public.application_documents where application_id = $1", [minorApp])).map(
        (d) => d.document_type_id,
      );
    const setBirthDate = (birthDate: string) =>
      db.admin(
        `insert into public.application_form_sections (application_id, section_id, data) values ($1, 'personal', jsonb_build_object('birthDate', $2::text))
         on conflict (application_id, section_id) do update set data = excluded.data`,
        [minorApp, birthDate],
      );
    const sync = () => db.asUser(erin, (s) => s.run("select public.sync_application_documents($1)", [minorApp]));

    // Date of birth not entered yet: not required. The invoice / Z report document added for Self Employed is in the list as required.
    await sync();
    expect(await slotIds()).not.toContain("parental_consent");
    expect(await slotIds()).toContain("self_invoices_or_z_reports");

    await setBirthDate("2015-01-01");
    await sync();
    expect(await slotIds()).toContain("parental_consent");

    // Once the date of birth is corrected and the applicant is an adult (if no file was uploaded) it leaves the list.
    await setBirthDate("1990-01-01");
    await sync();
    expect(await slotIds()).not.toContain("parental_consent");

    // An invalid date does not break the sync.
    await setBirthDate("tarih-degil");
    await sync();
    expect(await slotIds()).not.toContain("parental_consent");
    await setBirthDate("2015-02-30");
    await expect(sync()).resolves.not.toThrow();
  });

  it("no session can call the age check function directly", async () => {
    for (const who of [alice, staff]) {
      expect(await rejection(db.asUser(who, (s) => s.run("select private.applicant_is_minor($1)", [aliceApp])))).toMatch(/permission denied/i);
    }
    expect(await rejection(db.asAnon((s) => s.run("select private.applicant_is_minor($1)", [aliceApp])))).toMatch(/permission denied/i);
  });

  it("another customer cannot sync or see the document slots", async () => {
    expect(await rejection(db.asUser(alice, (s) => s.run("select public.sync_application_documents($1)", [app])))).toMatch(/forbidden/);
    // The same response is returned for an application that does not exist (the application's existence is not leaked).
    expect(
      await rejection(db.asUser(alice, (s) => s.run("select public.sync_application_documents('99999999-9999-4999-8999-999999999999')"))),
    ).toMatch(/forbidden/);
    expect(await rejection(db.asUser(exStaff, (s) => s.run("select public.sync_application_documents($1)", [app])))).toMatch(/forbidden/);
    expect(await db.asUser(alice, (s) => s.query("select id from public.application_documents where application_id = $1", [app]))).toEqual([]);
    expect(await db.asUser(alice, (s) => s.query("select id from public.application_files where application_id = $1", [app]))).toEqual([]);
  });

  it("a customer cannot add document records or change the review status or the rule", async () => {
    expect(
      await rejection(db.asUser(erin, (s) => s.run("insert into public.application_documents (application_id, custom_label) values ($1, 'x')", [app]))),
    ).toMatch(DENIED);
    for (const set of ["review_status = 'approved'", "requirement = 'optional'", "allow_not_applicable = true", "reupload_allowed = true"]) {
      expect(await db.asUser(erin, (s) => s.run(`update public.application_documents set ${set} where id = $1`, [passportDoc])), set).toBe(0);
    }
    expect(await rejection(db.asUser(erin, (s) => s.run("update public.application_documents set not_applicable = true where id = $1", [marriageDoc])))).toMatch(
      /permission denied/i,
    );
    expect(await db.asUser(erin, (s) => s.run("delete from public.application_documents where id = $1", [passportDoc]))).toBe(0);
  });

  // The "Koşullu" rule and the "Bu belge benim için geçerli değil" declaration are gone.
  it("an old conditional document is optional; the 'not applicable' declaration function no longer exists", async () => {
    const [doc] = await db.admin<{ requirement: string; allow_not_applicable: boolean }>(
      "select requirement, allow_not_applicable from public.application_documents where id = $1",
      [marriageDoc],
    );
    expect(doc).toEqual({ requirement: "optional", allow_not_applicable: false });
    const [fn] = await db.admin<{ missing: boolean }>(
      "select to_regprocedure('public.svc_set_document_not_applicable(uuid, uuid, boolean, text)') is null as missing",
    );
    expect(fn!.missing).toBe(true);
  });

  it("a customer cannot insert, change or delete file records", async () => {
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(
      await rejection(
        db.asUser(erin, (s) =>
          s.run(
            `insert into public.application_files (id, application_id, application_document_id, kind, storage_path, original_name, mime_type, size_bytes, status)
             values ($1, $2, $3, 'document', $4, 'x.pdf', 'application/pdf', 1, 'ready')`,
            [id, app, passportDoc, `${app}/${id}.pdf`],
          ),
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(await rejection(db.asUser(erin, (s) => s.run("update public.application_files set status = 'ready' where application_id = $1", [app])))).toMatch(
      /permission denied/i,
    );
    expect(await rejection(db.asUser(erin, (s) => s.run("delete from public.application_files where application_id = $1", [app])))).toMatch(/permission denied/i);
  });

  it("a file record cannot point to another application's folder or a disallowed type", async () => {
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const insert = (path: string, mime = "application/pdf") =>
      db.asService((s) =>
        s.run(
          `insert into public.application_files (id, application_id, application_document_id, kind, storage_path, original_name, mime_type, size_bytes)
           values ($1, $2, $3, 'document', $4, 'x', $5, 1)`,
          [id, app, passportDoc, path, mime],
        ),
      );
    expect(await rejection(insert(`${aliceApp}/${id}.pdf`))).toMatch(/check constraint/i);
    expect(await rejection(insert(`${app}/../${id}.pdf`))).toMatch(/check constraint/i);
    expect(await rejection(insert(`${app}/${id}.exe`))).toMatch(/check constraint/i);
    expect(await rejection(insert(`${app}/${id}.pdf`, "application/x-msdownload"))).toMatch(/check constraint/i);
  });

  it("once staff mark a document 'correction needed' the customer can re-upload; the new file sends the document back to review", async () => {
    await db.asUser(staff, (s) => s.run("update public.application_documents set review_status = 'needs_correction', review_note = 'Okunmuyor' where id = $1", [passportDoc]));
    const [flagged] = await db.admin<{ reupload_allowed: boolean; reviewed_by: string }>(
      "select reupload_allowed, reviewed_by from public.application_documents where id = $1",
      [passportDoc],
    );
    expect(flagged).toEqual({ reupload_allowed: true, reviewed_by: staff });

    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await db.asService((s) =>
      s.run(
        `insert into public.application_files (id, application_id, application_document_id, kind, storage_path, original_name, mime_type, size_bytes, status, uploaded_by)
         values ($1, $2, $3, 'document', $4, 'pasaport.jpg', 'image/jpeg', 2048, 'pending', $5)`,
        [id, app, passportDoc, `${app}/${id}.jpg`, erin],
      ),
    );
    // An unverified (pending) file does not trigger a review.
    expect((await db.admin<{ review_status: string }>("select review_status from public.application_documents where id = $1", [passportDoc]))[0]!.review_status).toBe(
      "needs_correction",
    );
    await db.asService((s) => s.run("update public.application_files set status = 'ready' where id = $1", [id]));
    const [after] = await db.admin<{ review_status: string; review_note: string | null }>(
      "select review_status, review_note from public.application_documents where id = $1",
      [passportDoc],
    );
    expect(after).toEqual({ review_status: "pending", review_note: null });
    const audit = await db.admin<{ actor_id: string }>("select actor_id from public.audit_log where action = 'file.uploaded' and entity_id = $1", [id]);
    expect(audit).toEqual([{ actor_id: erin }]);
  });

  it("the audit log holds no sensitive data such as file names or form content", async () => {
    const rows = await db.admin<{ details: Record<string, unknown> }>("select details from public.audit_log");
    const text = JSON.stringify(rows);
    expect(text).not.toContain("pasaport.jpg");
    expect(text).not.toContain("10000000146");
    expect(text).not.toContain("Bekarım");
  });
});

describe("storage (storage.objects) policies", () => {
  beforeAll(async () => {
    await db.admin("insert into storage.objects (bucket_id, name) values ('application-files', $1), ('application-files', $2)", [
      `${aliceApp}/11111111-1111-4111-8111-111111111111.pdf`,
      `${bobApp}/22222222-2222-4222-8222-222222222222.pdf`,
    ]);
  });

  it("a customer only sees objects in their own application folder", async () => {
    const aliceObjects = await db.asUser(alice, (s) => s.query<{ name: string }>("select name from storage.objects"));
    expect(aliceObjects.length).toBeGreaterThan(0);
    expect(aliceObjects.every((o) => o.name.startsWith(`${aliceApp}/`))).toBe(true);
    const bobObjects = await db.asUser(bob, (s) => s.query<{ name: string }>("select name from storage.objects"));
    expect(bobObjects.map((o) => o.name)).toEqual([`${bobApp}/22222222-2222-4222-8222-222222222222.pdf`]);
  });

  it("staff see all objects", async () => {
    const all = await db.asUser(staff, (s) => s.query("select name from storage.objects"));
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it("a customer cannot write, overwrite or delete in storage directly (including their own folder)", async () => {
    expect(
      await rejection(
        db.asUser(alice, (s) => s.run("insert into storage.objects (bucket_id, name) values ('application-files', $1)", [`${aliceApp}/dogrudan.pdf`])),
      ),
    ).toMatch(/row-level security/i);
    expect(
      await rejection(db.asUser(alice, (s) => s.run("insert into storage.objects (bucket_id, name) values ('application-files', $1)", [`${bobApp}/sizma.pdf`]))),
    ).toMatch(/row-level security/i);
    expect(await db.asUser(alice, (s) => s.run("update storage.objects set name = name || '.x'"))).toBe(0);
    expect(await db.asUser(alice, (s) => s.run("delete from storage.objects"))).toBe(0);
    expect(await db.admin("select name from storage.objects where name like $1", [`${bobApp}/%`])).toHaveLength(1);
  });

  it("objects in another bucket or without a folder are not visible to the customer", async () => {
    await db.admin("insert into storage.buckets (id, name) values ('baska', 'baska')");
    await db.admin("insert into storage.objects (bucket_id, name) values ('baska', $1), ('application-files', 'koksuz.pdf')", [`${aliceApp}/x.pdf`]);
    const names = (await db.asUser(alice, (s) => s.query<{ name: string; bucket_id: string }>("select name, bucket_id from storage.objects"))).map(
      (o) => `${o.bucket_id}:${o.name}`,
    );
    expect(names.some((n) => n.startsWith("baska:"))).toBe(false);
    expect(names).not.toContain("application-files:koksuz.pdf");
  });
});

describe("configuration and audit log", () => {
  it("a customer cannot change settings, prices, document rules or the folder mapping", async () => {
    await db.asUser(staff, (s) => s.run("insert into public.fee_items (label, kind, amount, currency) values ('TEST danışmanlık', 'consultancy', 100, 'TRY')"));
    expect(await db.asUser(alice, (s) => s.run("update public.fee_items set amount = 0"))).toBe(0);
    expect(await db.asUser(alice, (s) => s.run("update public.document_types set requirement = 'optional'"))).toBe(0);
    expect(await db.asUser(alice, (s) => s.run("delete from public.document_types"))).toBe(0);
    expect(await db.asUser(alice, (s) => s.run("update public.settings set value = '\"TR00 SAHTE IBAN\"' where key = 'payment.iban'"))).toBe(0);
    expect(await db.asUser(alice, (s) => s.run("delete from public.cities"))).toBe(0);
    for (const sql of [
      "insert into public.fee_items (label, kind, amount, currency) values ('x', 'other', 1, 'TRY')",
      "insert into public.settings (key, value, visibility) values ('payment.sahte', '1', 'public')",
      "insert into public.zip_categories (folder_name) values ('sahte')",
      "insert into public.cities (name) values ('Sahte')",
      "insert into public.document_types (id, label, requirement) values ('sahte_belge', 'Sahte', 'optional')",
    ]) {
      expect(await rejection(db.asUser(alice, (s) => s.run(sql))), sql).toMatch(DENIED);
    }
    const [fee] = await db.admin<{ amount: string }>("select amount from public.fee_items where label = 'TEST danışmanlık'");
    expect(Number(fee!.amount)).toBe(100);
  });

  it("a customer cannot see staff-only settings or ZIP folders", async () => {
    await db.admin("insert into public.settings (key, value, visibility) values ('internal.test_note', '\"gizli\"', 'staff')");
    const keys = (await db.asUser(alice, (s) => s.query<{ key: string }>("select key from public.settings"))).map((r) => r.key);
    expect(keys).toContain("payment.iban");
    expect(keys).not.toContain("internal.test_note");
    expect(await db.asUser(alice, (s) => s.query("select id from public.zip_categories"))).toEqual([]);
    expect((await db.asUser(staff, (s) => s.query("select id from public.zip_categories"))).length).toBe(7);
  });

  it("staff can map a document to a ZIP folder; the change goes into the audit log", async () => {
    await db.asUser(staff, (s) =>
      s.run("update public.document_types set zip_category_id = (select id from public.zip_categories where folder_name = 'pasaport') where id = 'passport'"),
    );
    const audit = await db.admin<{ actor_id: string }>(
      "select actor_id from public.audit_log where action = 'config.update' and entity_type = 'document_types' and entity_id = 'passport'",
    );
    expect(audit).toEqual([{ actor_id: staff }]);
  });

  it("the customer cannot see the audit log; nobody, staff included, can change or delete it", async () => {
    expect(await db.asUser(alice, (s) => s.query("select id from public.audit_log"))).toEqual([]);
    expect((await db.asUser(staff, (s) => s.query("select id from public.audit_log"))).length).toBeGreaterThan(0);
    for (const who of [alice, staff]) {
      expect(await rejection(db.asUser(who, (s) => s.run("insert into public.audit_log (action) values ('x.y')")))).toMatch(/permission denied/i);
      expect(await rejection(db.asUser(who, (s) => s.run("update public.audit_log set action = 'x.y'")))).toMatch(/permission denied/i);
      expect(await rejection(db.asUser(who, (s) => s.run("delete from public.audit_log")))).toMatch(/permission denied/i);
    }
  });

  it("only staff can record a server event (e.g. ZIP download) and the action name is restricted", async () => {
    expect(await rejection(db.asUser(alice, (s) => s.run("select public.record_staff_event('export.zip', $1, '{}'::jsonb)", [aliceApp])))).toMatch(/forbidden/);
    expect(await rejection(db.asUser(staff, (s) => s.run("select public.record_staff_event('payment.status_changed', $1, '{}'::jsonb)", [aliceApp])))).toMatch(
      /invalid_action/,
    );
    await db.asUser(staff, (s) => s.run("select public.record_staff_event('export.zip', $1, '{\"included\": 3}'::jsonb)", [aliceApp]));
    const rows = await db.admin<{ actor_id: string }>("select actor_id from public.audit_log where action = 'export.zip' and application_id = $1", [aliceApp]);
    expect(rows).toEqual([{ actor_id: staff }]);
    // "Müşteriye hatırlat" record (migration 14); the customer cannot record it.
    await db.asUser(staff, (s) => s.run("select public.record_staff_event('customer.reminded', $1, '{\"state\": \"c\"}'::jsonb)", [aliceApp]));
    expect(await db.admin("select actor_id from public.audit_log where action = 'customer.reminded' and application_id = $1", [aliceApp])).toEqual([{ actor_id: staff }]);
    expect(await rejection(db.asUser(alice, (s) => s.run("select public.record_staff_event('customer.reminded', $1, '{}'::jsonb)", [aliceApp])))).toMatch(/forbidden/);
  });

  it("the staff list view only shows a customer their own applications", async () => {
    const mine = await db.asUser(alice, (s) => s.query<{ customer_id: string }>("select customer_id from public.application_overview"));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.customer_id === alice)).toBe(true);
    const all = await db.asUser(staff, (s) => s.query<{ customer_id: string }>("select customer_id from public.application_overview"));
    expect(new Set(all.map((r) => r.customer_id)).size).toBeGreaterThan(2);
  });

  it("the search field contains no ID or passport number", async () => {
    const rows = await db.asUser(staff, (s) => s.query<{ search_text: string }>("select search_text from public.application_overview"));
    expect(rows.some((r) => r.search_text.includes("10000000146"))).toBe(false);
  });
});

describe("risk assessment answers", () => {
  const ANSWERS = JSON.stringify([2, 1, 1, 2, 1, 2, 3, 2, 3, 2, 3, 2, 0, 2, 1, 3]);
  const insert = "insert into public.risk_assessments (user_id, version, answers) values ($1, 1, $2::jsonb)";

  beforeAll(async () => {
    await db.asUser(alice, (s) => s.run(insert, [alice, ANSWERS]));
  });

  it("a user saves, reads and updates their own answers", async () => {
    const own = await db.asUser(alice, (s) => s.query<{ user_id: string; version: number }>("select user_id, version from public.risk_assessments"));
    expect(own).toEqual([{ user_id: alice, version: 1 }]);
    expect(await db.asUser(alice, (s) => s.run("update public.risk_assessments set answers = $2::jsonb where user_id = $1", [alice, ANSWERS]))).toBe(1);
  });

  it("another customer cannot see, change or delete these answers", async () => {
    expect(await db.asUser(bob, (s) => s.query("select user_id from public.risk_assessments"))).toEqual([]);
    expect(await db.asUser(bob, (s) => s.run("update public.risk_assessments set version = 2 where user_id = $1", [alice]))).toBe(0);
    expect(await db.asUser(bob, (s) => s.run("delete from public.risk_assessments where user_id = $1", [alice]))).toBe(0);
    expect(await db.admin("select version from public.risk_assessments where user_id = $1", [alice])).toEqual([{ version: 1 }]);
  });

  it("nobody can save answers on someone else's behalf or hand the row over to someone else", async () => {
    expect(await rejection(db.asUser(bob, (s) => s.run(insert, [alice, ANSWERS])))).toMatch(/row-level security|duplicate key/i);
    await db.asUser(bob, (s) => s.run(insert, [bob, ANSWERS]));
    expect(await rejection(db.asUser(bob, (s) => s.run("update public.risk_assessments set user_id = $2 where user_id = $1", [bob, exStaff])))).toMatch(
      /row-level security/i,
    );
    expect(await rejection(db.asUser(staff, (s) => s.run(insert, [exStaff, ANSWERS])))).toMatch(/row-level security/i);
  });

  it("staff read all answers but cannot change them; disabled staff cannot read", async () => {
    const all = await db.asUser(staff, (s) => s.query<{ user_id: string }>("select user_id from public.risk_assessments order by user_id"));
    expect(all.map((r) => r.user_id).sort()).toEqual([alice, bob].sort());
    expect(await db.asUser(staff, (s) => s.run("update public.risk_assessments set version = 9 where user_id = $1", [alice]))).toBe(0);
    expect(await db.asUser(staff, (s) => s.run("delete from public.risk_assessments where user_id = $1", [alice]))).toBe(0);
    expect(await db.asUser(exStaff, (s) => s.query("select user_id from public.risk_assessments"))).toEqual([]);
  });

  it("a visitor who is not signed in cannot access the table", async () => {
    expect(await rejection(db.asAnon((s) => s.query("select user_id from public.risk_assessments")))).toMatch(/permission denied/i);
    expect(await rejection(db.asAnon((s) => s.run(insert, [alice, ANSWERS])))).toMatch(/permission denied/i);
  });

  it("answers must be an array and their size is limited", async () => {
    const carol = await db.createUser("risk-bicim@example.com", { first_name: "Biçim", last_name: "Test" });
    expect(await rejection(db.asUser(carol, (s) => s.run(insert, [carol, '{"a":1}'])))).toMatch(/check constraint/i);
    expect(await rejection(db.asUser(carol, (s) => s.run(insert, [carol, "[]"])))).toMatch(/check constraint/i);
    expect(await rejection(db.asUser(carol, (s) => s.run(insert, [carol, JSON.stringify(Array.from({ length: 65 }, () => 0))])))).toMatch(/check constraint/i);
    expect(await rejection(db.asUser(carol, (s) => s.run(insert, [carol, JSON.stringify(["x".repeat(2000)])])))).toMatch(/check constraint/i);
    expect(
      await rejection(db.asUser(carol, (s) => s.run("insert into public.risk_assessments (user_id, version, answers) values ($1, 0, $2::jsonb)", [carol, ANSWERS]))),
    ).toMatch(/check constraint/i);
  });

  it("a user can delete their own answers; deleting the account deletes the answers too", async () => {
    expect(await db.asUser(bob, (s) => s.run("delete from public.risk_assessments where user_id = $1", [bob]))).toBe(1);
    const temp = await db.createUser("risk-silinecek@example.com", { first_name: "Silinecek", last_name: "Test" });
    await db.asUser(temp, (s) => s.run(insert, [temp, ANSWERS]));
    await db.admin("delete from auth.users where id = $1", [temp]);
    expect(await db.admin("select user_id from public.risk_assessments where user_id = $1", [temp])).toEqual([]);
  });
});

describe("vize sonucu", () => {
  let frank: string;
  let app: string;
  const fileId = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, "0")}`;
  const call = "select public.svc_set_visa_outcome($1, $2, $3, $4, $5) as previous";

  async function insertFile(id: string, applicationId: string, kind = "visa_result"): Promise<void> {
    await db.asService((s) =>
      s.run(
        `insert into public.application_files (id, application_id, kind, storage_path, original_name, mime_type, size_bytes, status, uploaded_by)
         values ($1, $2, $3, $4, 'sonuc.png', 'image/png', 1024, 'ready', $5)`,
        [id, applicationId, kind, `${applicationId}/${id}.png`, staff],
      ),
    );
  }

  beforeAll(async () => {
    frank = await db.createUser("vize-sonucu@example.com", { first_name: "Frank", last_name: "Test" });
    app = await createDraft(frank);
    await submit(frank, app);
    await db.asUser(staff, (s) => s.run("update public.applications set payment_status = 'verified' where id = $1", [app]));
    await db.asUser(staff, (s) => s.run("update public.applications set status = 'documents_complete' where id = $1", [app]));
    await insertFile(fileId(1), app);
    await insertFile(fileId(2), app);
  });

  it("neither customers nor staff can write the outcome columns directly", async () => {
    for (const user of [frank, staff]) {
      expect(await rejection(db.asUser(user, (s) => s.run("update public.applications set visa_outcome = 'approved' where id = $1", [app])))).toMatch(
        /permission denied/i,
      );
      expect(await rejection(db.asUser(user, (s) => s.run("update public.applications set visa_outcome_file_id = $2 where id = $1", [app, fileId(1)])))).toMatch(
        /permission denied/i,
      );
    }
  });

  it("only the server (service role) can call the outcome function", async () => {
    expect(await rejection(db.asUser(staff, (s) => s.query(call, [staff, app, "approved", "", null])))).toMatch(/permission denied/i);
    expect(await rejection(db.asUser(frank, (s) => s.query(call, [staff, app, "approved", "", null])))).toMatch(/permission denied/i);
    expect(await rejection(db.asAnon((s) => s.query(call, [staff, app, "approved", "", null])))).toMatch(/permission denied/i);
  });

  it("rejected if the actor is a customer or disabled staff", async () => {
    expect(await rejection(db.asService((s) => s.query(call, [frank, app, "approved", "", null])))).toMatch(/forbidden/);
    expect(await rejection(db.asService((s) => s.query(call, [exStaff, app, "approved", "", null])))).toMatch(/forbidden/);
  });

  it("an invalid outcome, a refusal without a reason, an unsuitable stage and another application's file are rejected", async () => {
    expect(await rejection(db.asService((s) => s.query(call, [staff, app, "belki", "", null])))).toMatch(/visa_outcome_invalid/);
    expect(await rejection(db.asService((s) => s.query(call, [staff, app, "refused", "   ", null])))).toMatch(/visa_outcome_note_required/);
    // Draft (alice): the outcome cannot be recorded before the documents are complete
    expect(await rejection(db.asService((s) => s.query(call, [staff, aliceApp, "approved", "", null])))).toMatch(/visa_outcome_not_allowed/);
    // A file from another application and a file type that is not a visa outcome
    await insertFile(fileId(3), bobApp);
    expect(await rejection(db.asService((s) => s.query(call, [staff, app, "approved", "", fileId(3)])))).toMatch(/visa_outcome_file_invalid/);
    await insertFile(fileId(4), app, "staff_attachment");
    expect(await rejection(db.asService((s) => s.query(call, [staff, app, "approved", "", fileId(4)])))).toMatch(/visa_outcome_file_invalid/);
    // The rejected attempts changed nothing.
    const [row] = await db.admin<{ status: string; visa_outcome: string | null }>("select status, visa_outcome from public.applications where id = $1", [app]);
    expect(row).toEqual({ status: "documents_complete", visa_outcome: null });
  });

  it("the outcome is recorded: status updated, audit entry written; the customer reads their own outcome, nobody else can", async () => {
    const [first] = await db.asService((s) => s.query<{ previous: string | null }>(call, [staff, app, "approved", " Tebrikler ", fileId(1)]));
    expect(first!.previous).toBeNull();
    const own = await db.asUser(frank, (s) =>
      s.query<{ status: string; visa_outcome: string; visa_outcome_note: string; visa_outcome_file_id: string }>(
        "select status, visa_outcome, visa_outcome_note, visa_outcome_file_id from public.applications where id = $1",
        [app],
      ),
    );
    expect(own).toEqual([{ status: "result_communicated", visa_outcome: "approved", visa_outcome_note: "Tebrikler", visa_outcome_file_id: fileId(1) }]);
    expect(await db.asUser(bob, (s) => s.query("select visa_outcome from public.applications where id = $1", [app]))).toEqual([]);
    const audit = await db.admin<{ action: string; actor_id: string; details: Record<string, unknown> }>(
      "select action, actor_id, details from public.audit_log where application_id = $1 and action in ('application.status_changed', 'application.visa_outcome_set') order by created_at, action",
      [app],
    );
    expect(audit.filter((a) => a.action === "application.visa_outcome_set")).toEqual([
      { action: "application.visa_outcome_set", actor_id: staff, details: { outcome: "approved", with_file: true } },
    ]);
    expect(audit.some((a) => a.action === "application.status_changed" && a.details.to === "result_communicated" && a.actor_id === staff)).toBe(true);
  });

  it("if the outcome is corrected, the id of the replaced old screenshot is returned (the server deletes it)", async () => {
    const [second] = await db.asService((s) => s.query<{ previous: string | null }>(call, [staff, app, "refused", "Seyahat amacı yeterince açıklanmadı.", fileId(2)]));
    expect(second!.previous).toBe(fileId(1));
    const [same] = await db.asService((s) => s.query<{ previous: string | null }>(call, [staff, app, "refused", "Seyahat amacı yeterince açıklanmadı.", fileId(2)]));
    expect(same!.previous).toBeNull();
    const [row] = await db.admin<{ visa_outcome: string; visa_outcome_note: string }>("select visa_outcome, visa_outcome_note from public.applications where id = $1", [app]);
    expect(row).toEqual({ visa_outcome: "refused", visa_outcome_note: "Seyahat amacı yeterince açıklanmadı." });
    // The refusal reason is also required by a database constraint for a refusal.
    expect(await rejection(db.admin("update public.applications set visa_outcome_note = null where id = $1", [app]))).toMatch(/check constraint/i);
  });

  it("only the applicant and active staff read the status history; only status and time are returned", async () => {
    const history = "select status, changed_at from public.application_status_history($1)";
    const own = await db.asUser(frank, (s) => s.query<{ status: string; changed_at: string }>(history, [app]));
    // Once the payment was verified, review started by itself; "Evraklar tamamlandı" is the consultant's mark.
    expect(own.map((r) => r.status)).toEqual(["submitted", "in_review", "documents_complete", "result_communicated"]);
    expect(Object.keys(own[0]!).sort()).toEqual(["changed_at", "status"]);
    expect((await db.asUser(staff, (s) => s.query(history, [app]))).length).toBe(4);
    // Another customer, disabled staff: empty list (the application's existence is not revealed either)
    expect(await db.asUser(bob, (s) => s.query(history, [app]))).toEqual([]);
    expect(await db.asUser(exStaff, (s) => s.query(history, [app]))).toEqual([]);
    expect(await rejection(db.asAnon((s) => s.query(history, [app])))).toMatch(/permission denied/i);
  });

  it("a new application gets a random reference number; no sequence counter is used", async () => {
    const [before] = await db.admin<{ last_value: string; is_called: boolean }>("select last_value, is_called from public.application_reference_seq");
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await createDraft(frank);
      codes.push((await db.admin<{ reference_code: string }>("select reference_code from public.applications where id = $1", [id]))[0]!.reference_code);
    }
    for (const code of codes) expect(code).toMatch(/^VB-\d{4}-[1-9]\d{5}$/);
    expect(new Set(codes).size).toBe(codes.length);
    const [after] = await db.admin<{ last_value: string; is_called: boolean }>("select last_value, is_called from public.application_reference_seq");
    expect(after).toEqual(before);
  });
});

describe("bildirim silme", () => {
  it("a customer can only delete their own notifications; an anonymous visitor cannot delete", async () => {
    const [mine] = await db.admin<{ id: string }>(
      "insert into public.notifications (user_id, kind, title) values ($1, 'message.new', 'Silinecek') returning id",
      [alice],
    );
    const [others] = await db.admin<{ id: string }>(
      "insert into public.notifications (user_id, kind, title) values ($1, 'message.new', 'Bob kalsın') returning id",
      [bob],
    );
    expect(await db.asUser(alice, (s) => s.run("delete from public.notifications where id = $1", [others!.id]))).toBe(0);
    expect(await db.asUser(staff, (s) => s.run("delete from public.notifications where id = $1", [others!.id]))).toBe(0);
    expect(await rejection(db.asAnon((s) => s.run("delete from public.notifications where id = $1", [others!.id])))).toMatch(/permission denied/i);
    expect(await db.asUser(alice, (s) => s.run("delete from public.notifications where id = $1", [mine!.id]))).toBe(1);
    expect(await db.admin("select id from public.notifications where id = $1", [others!.id])).toHaveLength(1);
  });
});

describe("randevu: tarihler uymuyor", () => {
  const save = (owner: string, app: string, prefs: unknown[], outside?: boolean) =>
    db.asService((s) =>
      outside === undefined
        ? s.run("select public.svc_set_appointment_preferences($1, $2, $3::jsonb)", [owner, app, JSON.stringify(prefs)])
        : s.run("select public.svc_set_appointment_preferences($1, $2, $3::jsonb, $4)", [owner, app, JSON.stringify(prefs), outside]),
    );

  it("if the dates don't suit, 1–3 days are accepted and the same day cannot be picked twice; 'Tüm gün' can also be picked for a normal preference", async () => {
    const owner = await db.createUser("tarih-uymuyor@example.com", { first_name: "Tarih", last_name: "Test" });
    const app = await createDraft(owner);
    await save(owner, app, [{ date: "2026-11-20", slot: "full_day" }], true);
    const [row] = await db.admin<{ appointment_outside_window: boolean }>("select appointment_outside_window from public.applications where id = $1", [app]);
    expect(row!.appointment_outside_window).toBe(true);
    expect(
      await rejection(
        save(
          owner,
          app,
          [
            { date: "2026-11-20", slot: "morning" },
            { date: "2026-11-20", slot: "evening" },
          ],
          true,
        ),
      ),
    ).toMatch(/duplicate_preference_date/);
    const four = ["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"].map((date) => ({ date, slot: "morning" }));
    expect(await rejection(save(owner, app, four, true))).toMatch(/one_to_three_preferences_required/);
    expect(await rejection(save(owner, app, [], true))).toMatch(/one_to_three_preferences_required/);
    // The flag clears when returning to a normal preference; "Tüm gün" can also be picked in the calendar for a normal preference (migration 10).
    await save(owner, app, [
      { date: "2026-10-20", slot: "full_day" },
      { date: "2026-10-21", slot: "morning" },
      { date: "2026-10-22", slot: "evening" },
    ]);
    const [after] = await db.admin<{ appointment_outside_window: boolean }>("select appointment_outside_window from public.applications where id = $1", [app]);
    expect(after!.appointment_outside_window).toBe(false);
  });

  it("can be submitted with a single preference (both when dates don't suit and for a normal preference); not without preferences", async () => {
    const owner = await db.createUser("tarih-gonder@example.com", { first_name: "Tarih", last_name: "Gönder" });
    const app = await createDraft(owner);
    await save(owner, app, [{ date: "2026-11-20", slot: "full_day" }], true);
    await db.asService((s) => s.run(ACCEPT_TERMS, [owner, app, TERMS_VERSION]));
    await db.asService((s) => s.run("select public.svc_submit_application($1, $2, '[]'::jsonb)", [owner, app]));
    const [row] = await db.admin<{ status: string }>("select status from public.applications where id = $1", [app]);
    expect(row!.status).toBe("submitted");

    const other = await createDraft(owner);
    expect(await rejection(db.asService((s) => s.run("select public.svc_submit_application($1, $2, '[]'::jsonb)", [owner, other])))).toMatch(
      /appointment_preferences_missing/,
    );
    await db.admin("insert into public.appointment_preferences (application_id, rank, preferred_date, slot) values ($1, 1, '2026-10-20', 'morning')", [other]);
    await db.asService((s) => s.run(ACCEPT_TERMS, [owner, other, TERMS_VERSION]));
    await db.asService((s) => s.run("select public.svc_submit_application($1, $2, '[]'::jsonb)", [owner, other]));
  });

  it("the customer cannot change the flag themselves or call the save function directly", async () => {
    expect(
      await rejection(db.asUser(alice, (s) => s.run("update public.applications set appointment_outside_window = true where id = $1", [aliceApp]))),
    ).toMatch(/permission denied/i);
    expect(
      await rejection(db.asUser(alice, (s) => s.run("select public.svc_set_appointment_preferences($1, $2, '[]'::jsonb, true)", [alice, aliceApp]))),
    ).toMatch(/permission denied/i);
  });
});

describe("hesap silme", () => {
  const fileFor = async (owner: string, app: string, n: number) => {
    const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
    await db.asService((s) =>
      s.run(
        `insert into public.application_files (id, application_id, kind, storage_path, original_name, mime_type, size_bytes, status, uploaded_by)
         values ($1, $2, 'payment_receipt', $3, 'dekont.pdf', 'application/pdf', 100, 'ready', $4)`,
        [id, app, `${app}/${id}.pdf`, owner],
      ),
    );
    return `${app}/${id}.pdf`;
  };

  it("a customer only opens a request in their own name; cannot write status or staff fields or see someone else's request", async () => {
    const carol = await db.createUser("silme-talebi@example.com", { first_name: "Carol", last_name: "Test" });
    expect(await rejection(db.asUser(carol, (s) => s.run("insert into public.account_deletion_requests (user_id) values ($1)", [bob])))).toMatch(DENIED);
    expect(
      await rejection(db.asUser(carol, (s) => s.run("insert into public.account_deletion_requests (user_id, status) values ($1, 'rejected')", [carol]))),
    ).toMatch(/permission denied/i);
    await db.asUser(carol, (s) => s.run("insert into public.account_deletion_requests (user_id) values ($1)", [carol]));
    // A second pending request cannot be opened at the same time.
    expect(await rejection(db.asUser(carol, (s) => s.run("insert into public.account_deletion_requests (user_id) values ($1)", [carol])))).toMatch(
      /duplicate key|unique/i,
    );
    expect(await db.asUser(carol, (s) => s.run("update public.account_deletion_requests set staff_note = 'x' where user_id = $1", [carol]))).toBe(0);
    expect(await rejection(db.asUser(carol, (s) => s.run("delete from public.account_deletion_requests where user_id = $1", [carol])))).toMatch(
      /permission denied/i,
    );
    expect(await db.asUser(alice, (s) => s.query("select id from public.account_deletion_requests where user_id = $1", [carol]))).toEqual([]);
    expect(await rejection(db.asAnon((s) => s.query("select id from public.account_deletion_requests")))).toMatch(/permission denied/i);
    // Staff see it and refuse with a reason; they cannot record an action on another staff member's behalf.
    expect(await db.asUser(staff, (s) => s.query("select id from public.account_deletion_requests where user_id = $1", [carol]))).toHaveLength(1);
    expect(
      await rejection(
        db.asUser(staff, (s) =>
          s.run("update public.account_deletion_requests set status = 'rejected', staff_note = 'x', handled_by = $1 where user_id = $2", [exStaff, carol]),
        ),
      ),
    ).toMatch(DENIED);
    expect(
      await rejection(db.asUser(staff, (s) => s.run("update public.account_deletion_requests set status = 'rejected' where user_id = $1", [carol]))),
    ).toMatch(/check constraint/i);
    expect(
      await db.asUser(staff, (s) =>
        s.run(
          "update public.account_deletion_requests set status = 'rejected', staff_note = 'Yasal saklama süresi', handled_by = $1, handled_at = now() where user_id = $2",
          [staff, carol],
        ),
      ),
    ).toBe(1);
    expect(await db.asUser(exStaff, (s) => s.run("update public.account_deletion_requests set staff_note = 'y' where user_id = $1", [carol]))).toBe(0);
  });

  it("a customer with a submitted application cannot delete their account themselves; with only drafts their data is deleted", async () => {
    const dave = await db.createUser("silme-gonderilmis@example.com", { first_name: "Dave", last_name: "Test" });
    const submitted = await createDraft(dave);
    await submit(dave, submitted);
    expect(await rejection(db.asService((s) => s.query("select * from public.svc_delete_account_data($1, $1)", [dave])))).toMatch(
      /has_submitted_applications/,
    );

    const gina = await db.createUser("silme-taslak@example.com", { first_name: "Gina", last_name: "Test" });
    const draftA = await createDraft(gina);
    const draftB = await createDraft(gina);
    const pathA = await fileFor(gina, draftA, 1);
    const pathB = await fileFor(gina, draftB, 2);
    const paths = await db.asService((s) => s.query<{ svc_delete_account_data: string }>("select * from public.svc_delete_account_data($1, $1)", [gina]));
    expect(paths.map((p) => p.svc_delete_account_data).sort()).toEqual([pathA, pathB].sort());
    expect(await db.admin("select id from public.applications where customer_id = $1", [gina])).toEqual([]);
    const audit = await db.admin<{ actor_id: string | null; details: Record<string, unknown> }>(
      "select actor_id, details from public.audit_log where action = 'account.deleted' and entity_id = $1",
      [gina],
    );
    expect(audit).toEqual([{ actor_id: null, details: { by: "customer", application_count: 2 } }]);
  });

  it("staff only delete when a request is pending; another account or a staff account cannot be deleted; sessions cannot call the function", async () => {
    const frank = await db.createUser("silme-personel@example.com", { first_name: "Frank", last_name: "Test" });
    const app = await createDraft(frank);
    await submit(frank, app);
    expect(await rejection(db.asService((s) => s.query("select * from public.svc_delete_account_data($1, $2)", [staff, frank])))).toMatch(
      /no_pending_request/,
    );
    expect(await rejection(db.asService((s) => s.query("select * from public.svc_delete_account_data($1, $2)", [bob, frank])))).toMatch(/forbidden/);
    expect(await rejection(db.asService((s) => s.query("select * from public.svc_delete_account_data($1, $2)", [exStaff, frank])))).toMatch(/forbidden/);
    expect(await rejection(db.asService((s) => s.query("select * from public.svc_delete_account_data($1, $1)", [staff])))).toMatch(/forbidden/);
    expect(await rejection(db.asUser(frank, (s) => s.query("select * from public.svc_delete_account_data($1, $1)", [frank])))).toMatch(
      /permission denied/i,
    );

    await db.asUser(frank, (s) => s.run("insert into public.account_deletion_requests (user_id) values ($1)", [frank]));
    await db.asService((s) => s.query("select * from public.svc_delete_account_data($1, $2)", [staff, frank]));
    expect(await db.admin("select id from public.applications where customer_id = $1", [frank])).toEqual([]);
    const audit = await db.admin<{ actor_id: string; details: Record<string, unknown> }>(
      "select actor_id, details from public.audit_log where action = 'account.deleted' and entity_id = $1",
      [frank],
    );
    expect(audit).toEqual([{ actor_id: staff, details: { by: "staff", application_count: 1 } }]);
  });
});

describe("document deletion in Settings", () => {
  // Since migration 20 the document is required by adding it to the "Öğrenci" rule.
  const newType = async (id: string) => {
    await db.asUser(staff, (s) => s.run("insert into public.document_types (id, label) values ($1, 'Deneme belgesi')", [id]));
    await db.asUser(staff, (s) =>
      s.run(
        "insert into public.document_rule_items (rule_id, document_type_id, requirement) select id, $1, 'optional' from public.document_rules where application_types = array['student'] and sponsor_status is null",
        [id],
      ),
    );
  };

  it("customers, former staff and anonymous visitors cannot delete documents", async () => {
    await newType("silme_yetki_deneme");
    expect(await rejection(db.asUser(alice, (s) => s.query("select public.delete_document_type('silme_yetki_deneme')")))).toMatch(/forbidden/);
    expect(await rejection(db.asUser(exStaff, (s) => s.query("select public.delete_document_type('silme_yetki_deneme')")))).toMatch(/forbidden/);
    expect(await rejection(db.asAnon((s) => s.query("select public.delete_document_type('silme_yetki_deneme')")))).toMatch(/permission denied/i);
    expect(await db.admin("select id from public.document_types where id = 'silme_yetki_deneme'")).toHaveLength(1);
  });

  it("a document with empty slots in drafts is deleted; a document used in a submitted application is retired", async () => {
    const owner = await db.createUser("belge-sil@example.com", { first_name: "Belge", last_name: "Sil" });
    await newType("silme_bos_taslak");
    const draft = await createDraft(owner);
    await db.asUser(owner, (s) => s.run("update public.applications set application_types = array['student'] where id = $1", [draft]));
    await db.asUser(owner, (s) => s.run("select public.sync_application_documents($1)", [draft]));
    expect(await db.admin("select id from public.application_documents where document_type_id = 'silme_bos_taslak'")).toHaveLength(1);
    const [deleted] = await db.asUser(staff, (s) => s.query<{ delete_document_type: string }>("select public.delete_document_type('silme_bos_taslak')"));
    expect(deleted!.delete_document_type).toBe("deleted");
    expect(await db.admin("select id from public.document_types where id = 'silme_bos_taslak'")).toEqual([]);

    await newType("silme_gonderilmis");
    const sent = await createDraft(owner);
    await db.asUser(owner, (s) => s.run("update public.applications set application_types = array['student'] where id = $1", [sent]));
    await db.asUser(owner, (s) => s.run("select public.sync_application_documents($1)", [sent]));
    await submit(owner, sent);
    const [kept] = await db.asUser(staff, (s) => s.query<{ delete_document_type: string }>("select public.delete_document_type('silme_gonderilmis')"));
    expect(kept!.delete_document_type).toBe("deactivated");
    expect(await db.admin("select is_active from public.document_types where id = 'silme_gonderilmis'")).toEqual([{ is_active: false }]);
  });
});

describe("otomatik durum (12. dosya)", () => {
  let owner: string;
  let app: string;
  let passportDoc: string;
  const status = async (id = app) => (await db.admin<{ status: string }>("select status from public.applications where id = $1", [id]))[0]!.status;
  const asStaff = (sql: string, params: unknown[] = []) => db.asUser(staff, (s) => s.run(sql, params));

  beforeAll(async () => {
    owner = await db.createUser("otomatik-durum@example.com", { first_name: "Oto", last_name: "Durum" });
    app = await createDraft(owner);
    await db.asUser(owner, (s) => s.run("update public.applications set application_types = array['student'] where id = $1", [app]));
    await db.asUser(owner, (s) => s.run("select public.sync_application_documents($1)", [app]));
    passportDoc = (await db.admin<{ id: string }>("select id from public.application_documents where application_id = $1 and document_type_id = 'passport'", [app]))[0]!.id;
    await submit(owner, app);
  });

  it("the database rule and the UI rule give the same result in every case", async () => {
    for (const current of APPLICATION_STATUSES) {
      for (const payment of PAYMENT_STATUSES) {
        for (const appointment of APPOINTMENT_STATUSES) {
          for (const outstanding of [false, true]) {
            const [row] = await db.admin<{ next: string }>("select private.next_application_status($1, $2, $3, $4) as next", [current, payment, appointment, outstanding]);
            expect(row!.next, `${current}/${payment}/${appointment}/${outstanding}`).toBe(nextApplicationStatus(current, payment, appointment, outstanding));
          }
        }
      }
    }
  });

  it("once the payment is verified the application moves to review by itself; the transition is recorded under the consultant's name", async () => {
    expect(await status()).toBe("submitted");
    await asStaff("update public.applications set payment_status = 'verified' where id = $1", [app]);
    expect(await status()).toBe("in_review");
    const [audit] = await db.admin<{ actor_id: string; details: Record<string, unknown> }>(
      "select actor_id, details from public.audit_log where application_id = $1 and action = 'application.status_changed' order by id desc limit 1",
      [app],
    );
    expect(audit).toEqual({ actor_id: staff, details: { from: "submitted", to: "in_review" } });
  });

  it("when a problem is reported on a document the customer is expected to act; once they upload a new file, review resumes by itself", async () => {
    await asStaff("update public.application_documents set review_status = 'needs_correction', review_note = 'Okunmuyor' where id = $1", [passportDoc]);
    expect(await status()).toBe("awaiting_customer");
    // Documents cannot be marked complete while something is expected from the customer.
    expect(await rejection(asStaff("update public.applications set status = 'documents_complete' where id = $1", [app]))).toMatch(
      /status_change_not_allowed|customer_action_outstanding/,
    );

    const fileId = "abababab-abab-4bab-8bab-abababababab";
    await db.asService((s) =>
      s.run(
        `insert into public.application_files (id, application_id, application_document_id, kind, storage_path, original_name, mime_type, size_bytes, status, uploaded_by)
         values ($1, $2, $3, 'document', $4, 'pasaport.pdf', 'application/pdf', 2048, 'ready', $5)`,
        [fileId, app, passportDoc, `${app}/${fileId}.pdf`, owner],
      ),
    );
    expect(await status()).toBe("in_review");
    // A change without a session (server) is written as "Sistem" with the automatic flag.
    const [audit] = await db.admin<{ actor_id: string | null; details: Record<string, unknown> }>(
      "select actor_id, details from public.audit_log where application_id = $1 and action = 'application.status_changed' order by id desc limit 1",
      [app],
    );
    expect(audit).toEqual({ actor_id: null, details: { from: "awaiting_customer", to: "in_review", automatic: true } });
  });

  it("an open task and an open form wait on the customer; once both are closed review resumes", async () => {
    const [task] = await db.asUser(staff, (s) =>
      s.query<{ id: string }>("insert into public.customer_tasks (application_id, title, created_by) values ($1, 'İmzalı dilekçe getirin', $2) returning id", [app, staff]),
    );
    expect(await status()).toBe("awaiting_customer");
    await asStaff("update public.applications set form_locked = false where id = $1", [app]);
    await db.asService((s) => s.run("select public.svc_complete_task($1, $2)", [owner, task!.id]));
    expect(await status()).toBe("awaiting_customer");
    await asStaff("update public.applications set form_locked = true where id = $1", [app]);
    expect(await status()).toBe("in_review");
  });

  it("staff can only make the allowed transitions by hand", async () => {
    for (const next of ["submitted", "awaiting_customer", "awaiting_result", "result_communicated"]) {
      expect(await rejection(asStaff("update public.applications set status = $2 where id = $1", [app, next])), next).toMatch(/status_change_not_allowed/);
    }
    await asStaff("update public.applications set status = 'documents_complete' where id = $1", [app]);
    expect(await status()).toBe("documents_complete");
    await asStaff("update public.applications set status = 'in_review' where id = $1", [app]);
    expect(await status()).toBe("in_review");
    await asStaff("update public.applications set status = 'documents_complete' where id = $1", [app]);
    // A draft cannot be cancelled; when a cancellation is undone the status is recomputed from what has been done.
    expect(await rejection(asStaff("update public.applications set status = 'cancelled' where id = $1", [aliceApp]))).toMatch(/status_change_not_allowed/);
  });

  it("if new work is requested after documents are complete the mark is cleared; once done it returns to review", async () => {
    await asStaff("update public.application_documents set review_status = 'needs_correction', review_note = 'Süresi dolmuş' where id = $1", [passportDoc]);
    expect(await status()).toBe("awaiting_customer");
    await asStaff("update public.application_documents set review_status = 'approved', review_note = null where id = $1", [passportDoc]);
    expect(await status()).toBe("in_review");
    await asStaff("update public.applications set status = 'documents_complete' where id = $1", [app]);
  });

  it("an appointment cannot be sent without a date; the customer cannot write the appointment location fields", async () => {
    expect(await rejection(asStaff("update public.applications set appointment_status = 'scheduled', appointment_at = null where id = $1", [app]))).toMatch(
      /appointment_date_required/,
    );
    const draft = await createDraft(owner);
    expect(await rejection(db.asUser(owner, (s) => s.run("update public.applications set appointment_address = 'x' where id = $1", [draft])))).toMatch(DENIED);
    expect(await rejection(db.asUser(owner, (s) => s.run("update public.applications set appointment_location_id = null, appointment_address = 'x' where id = $1", [draft])))).toMatch(
      DENIED,
    );
  });

  it("once the appointment time has passed the appointment becomes 'took place', the application moves to awaiting result and the customer is notified", async () => {
    // An appointment whose time has not come yet (even if today) does not count as taken place (migration 19: time, not day).
    await asStaff("update public.applications set appointment_status = 'scheduled', appointment_at = now() + interval '1 hour' where id = $1", [app]);
    expect(await db.admin<{ n: number }>("select private.complete_past_appointments() as n")).toEqual([{ n: 0 }]);
    expect(await status()).toBe("documents_complete");

    // The time passed a few minutes ago: the entry point the app calls (service role only) processes the appointment.
    await asStaff("update public.applications set appointment_at = now() - interval '5 minutes' where id = $1", [app]);
    expect(await rejection(db.asUser(owner, (s) => s.query("select public.svc_complete_past_appointments()")))).toMatch(/permission denied/i);
    expect(await rejection(db.asUser(staff, (s) => s.query("select public.svc_complete_past_appointments()")))).toMatch(/permission denied/i);
    expect(await db.asService((s) => s.query<{ n: number }>("select public.svc_complete_past_appointments() as n"))).toEqual([{ n: 1 }]);
    const [row] = await db.admin<{ status: string; appointment_status: string }>("select status, appointment_status from public.applications where id = $1", [app]);
    expect(row).toEqual({ status: "awaiting_result", appointment_status: "completed" });
    const notifications = await db.asUser(owner, (s) => s.query<{ kind: string; title: string }>("select kind, title from public.notifications where application_id = $1", [app]));
    expect(notifications).toEqual([{ kind: "appointment.completed", title: "Randevunuz gerçekleşti" }]);
    expect(await db.admin("select actor_id from public.audit_log where application_id = $1 and action = 'appointment.completed'", [app])).toEqual([{ actor_id: null }]);
    // A second run does not process the same appointment again.
    expect(await db.admin<{ n: number }>("select private.complete_past_appointments() as n")).toEqual([{ n: 0 }]);

    // If the customer missed the appointment a new date is sent: the application returns to the documents complete stage.
    await asStaff("update public.applications set appointment_status = 'scheduled', appointment_at = now() + interval '5 days' where id = $1", [app]);
    expect(await status()).toBe("documents_complete");
  });

  it("cancelling and undoing a cancellation", async () => {
    await asStaff("update public.applications set status = 'cancelled' where id = $1", [app]);
    expect(await status()).toBe("cancelled");
    expect(await rejection(asStaff("update public.applications set status = 'in_review' where id = $1", [app]))).toMatch(/status_change_not_allowed/);
    await asStaff("update public.applications set status = 'submitted' where id = $1", [app]);
    // Returns to the stage before cancellation ("Evraklar tamamlandı"); the stored stage is cleared (migration 13).
    expect(await status()).toBe("documents_complete");
    expect(await db.admin("select cancelled_from_status from public.applications where id = $1", [app])).toEqual([{ cancelled_from_status: null }]);

    // If something new was requested from the customer during the cancellation, the automatic rule applies when it is undone.
    await asStaff("update public.applications set status = 'cancelled' where id = $1", [app]);
    expect(await db.admin("select cancelled_from_status from public.applications where id = $1", [app])).toEqual([{ cancelled_from_status: "documents_complete" }]);
    await asStaff("update public.application_documents set review_status = 'needs_correction', review_note = 'Yeniden yükleyiniz' where id = $1", [passportDoc]);
    expect(await status()).toBe("cancelled");
    await asStaff("update public.applications set status = 'submitted' where id = $1", [app]);
    expect(await status()).toBe("awaiting_customer");
    // The customer cannot write the stored stage.
    expect(await rejection(db.asUser(owner, (s) => s.run("update public.applications set cancelled_from_status = 'in_review' where id = $1", [app])))).toMatch(DENIED);
  });
});

describe("taslak silme (13. dosya)", () => {
  const call = "select public.svc_delete_draft($1, $2) as path";

  it("a customer only deletes their own draft; file paths are returned and related records are deleted too", async () => {
    const owner = await db.createUser("taslak-sil@example.com", { first_name: "Taslak", last_name: "Sil" });
    const draft = await createDraft(owner);
    await db.asUser(owner, (s) => s.run("update public.applications set application_types = array['student'] where id = $1", [draft]));
    await db.asUser(owner, (s) => s.run("select public.sync_application_documents($1)", [draft]));
    await db.asUser(owner, (s) => s.run("insert into public.application_form_sections (application_id, section_id, data) values ($1, 'contact', '{}')", [draft]));
    const doc = (await db.admin<{ id: string }>("select id from public.application_documents where application_id = $1 limit 1", [draft]))[0]!.id;
    const fileId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
    await db.asService((s) =>
      s.run(
        `insert into public.application_files (id, application_id, application_document_id, kind, storage_path, original_name, mime_type, size_bytes, status, uploaded_by)
         values ($1, $2, $3, 'document', $4, 'belge.pdf', 'application/pdf', 1024, 'ready', $5)`,
        [fileId, draft, doc, `${draft}/${fileId}.pdf`, owner],
      ),
    );

    // Cannot be deleted on behalf of another customer or staff.
    expect(await rejection(db.asService((s) => s.query(call, [bob, draft])))).toMatch(/forbidden/);
    expect(await rejection(db.asService((s) => s.query(call, [staff, draft])))).toMatch(/forbidden/);

    const rows = await db.asService((s) => s.query<{ path: string }>(call, [owner, draft]));
    expect(rows).toEqual([{ path: `${draft}/${fileId}.pdf` }]);
    expect(await db.admin("select id from public.applications where id = $1", [draft])).toEqual([]);
    expect(await db.admin("select id from public.application_documents where application_id = $1", [draft])).toEqual([]);
    expect(await db.admin("select section_id from public.application_form_sections where application_id = $1", [draft])).toEqual([]);
    expect(await db.admin("select id from public.application_files where id = $1", [fileId])).toEqual([]);
    const [audit] = await db.admin<{ actor_id: string; entity_id: string; application_id: string | null }>(
      "select actor_id, entity_id, application_id from public.audit_log where action = 'application.draft_deleted'",
    );
    expect(audit).toEqual({ actor_id: owner, entity_id: draft, application_id: null });
  });

  it("a submitted application cannot be deleted; sessions cannot call the function directly", async () => {
    const owner = await db.createUser("gonderilmis-sil@example.com", { first_name: "Gönderilmiş", last_name: "Sil" });
    const app = await createDraft(owner);
    await submit(owner, app);
    expect(await rejection(db.asService((s) => s.query(call, [owner, app])))).toMatch(/not_a_draft/);
    expect(await db.admin("select id from public.applications where id = $1", [app])).toHaveLength(1);
    expect(await rejection(db.asUser(owner, (s) => s.query(call, [owner, app])))).toMatch(/permission denied/i);
    expect(await rejection(db.asAnon((s) => s.query(call, [owner, app])))).toMatch(/permission denied/i);
    // The customer cannot delete the application directly in the table either.
    expect(await rejection(db.asUser(owner, (s) => s.run("delete from public.applications where id = $1", [app])))).toMatch(/permission denied/i);
  });
});

describe("randevu yerleri (12. dosya)", () => {
  let location: string;

  beforeAll(async () => {
    const [row] = await db.asUser(staff, (s) =>
      s.query<{ id: string }>("insert into public.appointment_locations (name, address) values ('TEST Başvuru Merkezi', 'TEST Mahallesi, Örnek Sokak No: 1') returning id"),
    );
    location = row!.id;
  });

  it("staff add, change and see them; changes go into the audit log", async () => {
    expect(await db.asUser(staff, (s) => s.run("update public.appointment_locations set address = 'TEST Yeni adres' where id = $1", [location]))).toBe(1);
    expect(await db.asUser(staff, (s) => s.query("select name from public.appointment_locations where id = $1", [location]))).toEqual([{ name: "TEST Başvuru Merkezi" }]);
    const audit = await db.admin("select action from public.audit_log where entity_type = 'appointment_locations' and entity_id = $1 order by id", [location]);
    expect(audit).toEqual([{ action: "config.insert" }, { action: "config.update" }]);
  });

  it("customers and former staff cannot see, add, change or delete them", async () => {
    for (const user of [alice, exStaff]) {
      expect(await db.asUser(user, (s) => s.query("select id from public.appointment_locations"))).toEqual([]);
      expect(await rejection(db.asUser(user, (s) => s.run("insert into public.appointment_locations (name, address) values ('Sahte', 'Sahte')")))).toMatch(DENIED);
      expect(await db.asUser(user, (s) => s.run("update public.appointment_locations set name = 'Sahte' where id = $1", [location]))).toBe(0);
      expect(await db.asUser(user, (s) => s.run("delete from public.appointment_locations where id = $1", [location]))).toBe(0);
    }
    expect(await db.admin("select name from public.appointment_locations where id = $1", [location])).toEqual([{ name: "TEST Başvuru Merkezi" }]);
  });

  it("an anonymous visitor cannot access the table", async () => {
    expect(await rejection(db.asAnon((s) => s.query("select id from public.appointment_locations")))).toMatch(/permission denied/i);
    expect(await rejection(db.asAnon((s) => s.run("insert into public.appointment_locations (name, address) values ('x', 'y')")))).toMatch(/permission denied/i);
  });

  it("an empty name or address is not accepted; when a location is deleted the copy in a sent appointment remains", async () => {
    expect(await rejection(db.asUser(staff, (s) => s.run("insert into public.appointment_locations (name, address) values ('  ', 'Adres')")))).toMatch(/check constraint/i);
    expect(await rejection(db.asUser(staff, (s) => s.run("insert into public.appointment_locations (name, address) values ('Ad', '')")))).toMatch(/check constraint/i);

    const customer = await db.createUser("randevu-yeri@example.com", { first_name: "Yer", last_name: "Test" });
    const app = await createDraft(customer);
    await submit(customer, app);
    await db.asUser(staff, (s) =>
      s.run(
        `update public.applications set appointment_status = 'scheduled', appointment_at = now() + interval '3 days',
                appointment_location = 'TEST Başvuru Merkezi', appointment_address = 'TEST Yeni adres', appointment_location_id = $2
         where id = $1`,
        [app, location],
      ),
    );
    expect(await db.asUser(staff, (s) => s.run("delete from public.appointment_locations where id = $1", [location]))).toBe(1);
    const own = await db.asUser(customer, (s) =>
      s.query("select appointment_location, appointment_address, appointment_location_id from public.applications where id = $1", [app]),
    );
    expect(own).toEqual([{ appointment_location: "TEST Başvuru Merkezi", appointment_address: "TEST Yeni adres", appointment_location_id: null }]);
  });
});

describe("e-mail notification queue (migration 14)", () => {
  const claim = "select id, kind, email, first_name, reference_code from public.svc_claim_notification_emails(50)";
  const finish = "select public.svc_finish_notification_email($1, $2, $3)";
  let customer: string;
  let app: string;

  beforeAll(async () => {
    customer = await db.createUser("eposta-kuyrugu@example.com", { first_name: "Kuyruk", last_name: "Test" });
    app = await createDraft(customer);
    // So notifications from earlier tests do not affect this test.
    await db.admin("update public.notifications set email_sent_at = now()");
  });

  // Staff insert the notification with their own session (the id is found separately since they cannot read the customer's notification).
  const notify = async (title: string) => {
    await db.asUser(staff, (s) =>
      s.run("insert into public.notifications (user_id, application_id, kind, title, body) values ($1, $2, 'message.new', $3, 'TEST')", [customer, app, title]),
    );
    return (await db.admin<{ id: string }>("select id from public.notifications where title = $1", [title]))[0]!.id;
  };

  it("a notification is taken once; once marked sent it is not taken again", async () => {
    const id = await notify("TEST ilk bildirim");
    const first = await db.asService((s) => s.query<{ id: string; email: string; first_name: string; reference_code: string }>(claim));
    expect(first).toEqual([{ id, kind: "message.new", email: "eposta-kuyrugu@example.com", first_name: "Kuyruk", reference_code: expect.stringMatching(/^VB-/) }]);
    // A taken row is not taken by a second sender for 10 minutes.
    expect(await db.asService((s) => s.query(claim))).toEqual([]);
    await db.asService((s) => s.run(finish, [id, true, null]));
    expect(await db.admin("select email_sent_at is not null as sent, email_attempts, email_error from public.notifications where id = $1", [id])).toEqual([
      { sent: true, email_attempts: 1, email_error: null },
    ]);
    expect(await db.asService((s) => s.query(claim))).toEqual([]);
  });

  it("a notification that could not be sent is retried; after 5 attempts and when older than 2 days it is not taken", async () => {
    const id = await notify("TEST başarısız");
    for (let attempt = 1; attempt <= 5; attempt++) {
      const rows = await db.asService((s) => s.query<{ id: string }>(claim));
      expect(rows.map((r) => r.id)).toEqual([id]);
      await db.asService((s) => s.run(finish, [id, false, "SMTP bağlantısı kurulamadı"]));
    }
    expect(await db.asService((s) => s.query(claim))).toEqual([]);
    expect(await db.admin("select email_attempts, email_error from public.notifications where id = $1", [id])).toEqual([
      { email_attempts: 5, email_error: "SMTP bağlantısı kurulamadı" },
    ]);

    const old = await notify("TEST eski");
    await db.admin("update public.notifications set created_at = now() - interval '3 days' where id = $1", [old]);
    expect(await db.asService((s) => s.query(claim))).toEqual([]);
  });

  it("sessions cannot call the queue or change the delivery columns", async () => {
    const id = await notify("TEST yetki");
    for (const user of [customer, staff]) {
      expect(await rejection(db.asUser(user, (s) => s.query(claim)))).toMatch(/permission denied/i);
      expect(await rejection(db.asUser(user, (s) => s.run(finish, [id, true, null])))).toMatch(/permission denied/i);
    }
    expect(await rejection(db.asAnon((s) => s.query(claim)))).toMatch(/permission denied/i);
    expect(await rejection(db.asUser(customer, (s) => s.run("update public.notifications set email_sent_at = now() where id = $1", [id])))).toMatch(
      /permission denied/i,
    );
  });
});

describe("two-factor authentication for staff (migration 15)", () => {
  it("a staff session without the code is an ordinary user: cannot see or change other people's data", async () => {
    // The same staff member sees applications in a session where the code was entered.
    expect((await db.asUser(staff, (s) => s.query("select id from public.applications where id = $1", [aliceApp]))).length).toBe(1);

    const noMfa = <T>(fn: (s: import("../helpers/db").Session) => Promise<T>) => db.asUserWithoutMfa(staff, fn);
    expect(await noMfa((s) => s.query("select id from public.applications where id = $1", [aliceApp]))).toEqual([]);
    expect(await noMfa((s) => s.query("select id from public.application_files"))).toEqual([]);
    expect(await noMfa((s) => s.query("select id from public.staff_notes"))).toEqual([]);
    expect(await noMfa((s) => s.query("select id from public.audit_log"))).toEqual([]);
    expect(await noMfa((s) => s.run("update public.applications set form_locked = true where id = $1", [aliceApp]))).toBe(0);
    expect(
      await rejection(noMfa((s) => s.run("insert into public.notifications (user_id, kind, title) values ($1, 'message.new', 'Sahte')", [alice]))),
    ).toMatch(DENIED);
    expect(await rejection(noMfa((s) => s.run("select public.record_staff_event('export.zip', $1, '{}'::jsonb)", [aliceApp])))).toMatch(/forbidden/);
  });

  it("staff authentication reset record: service role only, only on behalf of active staff, only for staff", async () => {
    const call = "select public.svc_record_staff_security_event($1, $2, $3)";
    await db.asService((s) => s.run(call, [staff, "staff.mfa_reset", exStaff]));
    const [audit] = await db.admin<{ actor_id: string; entity_type: string; entity_id: string; application_id: string | null }>(
      "select actor_id, entity_type, entity_id, application_id from public.audit_log where action = 'staff.mfa_reset'",
    );
    expect(audit).toEqual({ actor_id: staff, entity_type: "profile", entity_id: exStaff, application_id: null });
    expect(await rejection(db.asService((s) => s.run(call, [staff, "staff.access_changed", exStaff])))).toMatch(/invalid_action/);
    expect(await rejection(db.asService((s) => s.run(call, [exStaff, "staff.mfa_reset", staff])))).toMatch(/admin_required/);
    expect(await rejection(db.asService((s) => s.run(call, [staff, "staff.mfa_reset", alice])))).toMatch(/not_staff/);
    expect(await rejection(db.asUser(staff, (s) => s.run(call, [staff, "staff.mfa_reset", exStaff])))).toMatch(/permission denied/i);
  });
});

describe("withdrawing an appointment", () => {
  it("staff can withdraw a sent appointment; the application waits for a new date at 'Evraklar tamamlandı'", async () => {
    const owner = await db.createUser("randevu-geri@example.com", { first_name: "Randevu", last_name: "Geri" });
    const app = await createDraft(owner);
    await submit(owner, app);
    const asStaff = (sql: string) => db.asUser(staff, (s) => s.run(sql, [app]));
    await asStaff("update public.applications set payment_status = 'verified' where id = $1");
    await asStaff("update public.applications set status = 'documents_complete' where id = $1");
    await asStaff(
      "update public.applications set appointment_status = 'scheduled', appointment_at = now() + interval '10 days', appointment_location = 'TEST Merkez', appointment_note = 'TEST' where id = $1",
    );
    await asStaff(
      `update public.applications set appointment_status = 'preferences_submitted', appointment_at = null, appointment_location = null,
              appointment_address = null, appointment_location_id = null, appointment_note = null where id = $1`,
    );
    const [row] = await db.admin<Record<string, unknown>>(
      "select status, appointment_status, appointment_at, appointment_location, appointment_note from public.applications where id = $1",
      [app],
    );
    expect(row).toEqual({ status: "documents_complete", appointment_status: "preferences_submitted", appointment_at: null, appointment_location: null, appointment_note: null });
    // Preferences are not deleted.
    expect(await db.admin("select count(*)::int as n from public.appointment_preferences where application_id = $1", [app])).toEqual([{ n: 3 }]);
  });
});

describe("retention period for closed applications (migration 16)", () => {
  const list = "select application_id, reference_code, storage_paths from public.svc_expired_applications(50)";
  const remove = "select public.svc_delete_expired_application($1) as removed";
  let owner: string;

  /** An application whose result was sent some time ago (direct data setup). */
  async function closedApplication(monthsAgo: number, status: "result_communicated" | "cancelled" = "result_communicated") {
    const [row] = await db.admin<{ id: string }>(
      `insert into public.applications (customer_id, status, payment_status, submitted_at, visa_outcome, visa_outcome_at)
       values ($1, $2, 'verified', now() - interval '2 years', $3, $4) returning id`,
      [owner, status, status === "result_communicated" ? "approved" : null, status === "result_communicated" ? new Date(Date.now() - monthsAgo * 31 * 86_400_000).toISOString() : null],
    );
    return row!.id;
  }

  beforeAll(async () => {
    owner = await db.createUser("saklama@example.com", { first_name: "Saklama", last_name: "Test" });
  });

  it("no application is deleted while no period is set", async () => {
    const app = await closedApplication(30);
    expect(await db.asService((s) => s.query(list))).toEqual([]);
    expect(await db.asService((s) => s.query(remove, [app]))).toEqual([{ removed: false }]);
    expect(await db.admin("select id from public.applications where id = $1", [app])).toHaveLength(1);
  });

  it("an expired closed application is listed with its file paths and deleted; only the application number stays in the audit log", async () => {
    await db.admin("update public.settings set value = '6'::jsonb where key = 'retention.closed_months'");
    const old = await closedApplication(7);
    const recent = await closedApplication(2);
    const fileId = "efefefef-efef-4fef-8fef-efefefefefef";
    await db.admin(
      `insert into public.application_files (id, application_id, kind, storage_path, original_name, mime_type, size_bytes, status, uploaded_by)
       values ($1, $2, 'payment_receipt', $3, 'dekont.pdf', 'application/pdf', 1000, 'ready', $4)`,
      [fileId, old, `${old}/${fileId}.pdf`, owner],
    );
    const rows = await db.asService((s) => s.query<{ application_id: string; storage_paths: string[] }>(list));
    const ids = rows.map((r) => r.application_id);
    expect(ids).toContain(old);
    expect(ids).not.toContain(recent);
    expect(rows.find((r) => r.application_id === old)!.storage_paths).toEqual([`${old}/${fileId}.pdf`]);

    const [{ reference_code }] = await db.admin<{ reference_code: string }>("select reference_code from public.applications where id = $1", [old]);
    expect(await db.asService((s) => s.query(remove, [old]))).toEqual([{ removed: true }]);
    expect(await db.admin("select id from public.applications where id = $1", [old])).toEqual([]);
    expect(await db.admin("select id from public.application_files where id = $1", [fileId])).toEqual([]);
    const [audit] = await db.admin<{ actor_id: string | null; application_id: string | null; details: Record<string, unknown> }>(
      "select actor_id, application_id, details from public.audit_log where action = 'application.retention_deleted' and entity_id = $1",
      [old],
    );
    expect(audit).toEqual({ actor_id: null, application_id: null, details: { reference_code, months: 6 } });
    // An application whose period has not expired is not deleted; an open application is never listed.
    expect(await db.asService((s) => s.query(remove, [recent]))).toEqual([{ removed: false }]);
    expect(await db.asService((s) => s.query(remove, [aliceApp]))).toEqual([{ removed: false }]);
    await db.admin("update public.settings set value = 'null'::jsonb where key = 'retention.closed_months'");
  });

  it("sessions cannot call the functions; only staff see the setting", async () => {
    for (const user of [alice, staff]) {
      expect(await rejection(db.asUser(user, (s) => s.query(list)))).toMatch(/permission denied/i);
      expect(await rejection(db.asUser(user, (s) => s.query(remove, [aliceApp])))).toMatch(/permission denied/i);
    }
    expect(await db.asUser(alice, (s) => s.query("select key from public.settings where key = 'retention.closed_months'"))).toEqual([]);
    expect(await db.asUser(staff, (s) => s.query("select key from public.settings where key = 'retention.closed_months'"))).toEqual([
      { key: "retention.closed_months" },
    ]);
  });
});

describe("form edit request, map link and Fee step (migration 17)", () => {
  const request = "select public.svc_request_form_edit($1, $2, $3)";
  const finish = "select public.svc_finish_form_correction($1, $2)";
  const row = async (id: string) =>
    (
      await db.admin<{ status: string; form_locked: boolean; form_edit_requested_at: string | null; form_edit_request_note: string | null }>(
        "select status, form_locked, form_edit_requested_at, form_edit_request_note from public.applications where id = $1",
        [id],
      )
    )[0]!;

  it("the customer cannot write the request and map columns directly; the Fee step mark only in a draft", async () => {
    const owner = await db.createUser("form-istek-sutun@example.com", { first_name: "Form", last_name: "Sütun" });
    const draft = await createDraft(owner);
    expect(await db.asUser(owner, (s) => s.run("update public.applications set fee_step_seen_at = now() where id = $1", [draft]))).toBe(1);
    for (const column of ["form_edit_requested_at = now()", "form_edit_request_note = 'x'", "appointment_maps_url = 'https://maps.example.com/x'"]) {
      expect(await rejection(db.asUser(owner, (s) => s.run(`update public.applications set ${column} where id = $1`, [draft]))), column).toMatch(DENIED);
    }
    // Protected values sent by the client for a new application are ignored.
    const [inserted] = await db.asUser(owner, (s) =>
      s.query<{ form_edit_requested_at: string | null; appointment_maps_url: string | null }>(
        "insert into public.applications (customer_id, form_edit_requested_at, appointment_maps_url) values ($1, now(), 'https://maps.example.com/x') returning form_edit_requested_at, appointment_maps_url",
        [owner],
      ),
    );
    expect(inserted).toEqual({ form_edit_requested_at: null, appointment_maps_url: null });
    // In a submitted application the Fee step mark cannot be changed either.
    const app = await createDraft(owner);
    await submit(owner, app);
    expect(await rejection(db.asUser(owner, (s) => s.run("update public.applications set fee_step_seen_at = now() where id = $1", [app])))).toMatch(DENIED);
  });

  it("form edit request: owner only, on a locked form and once; the request closes when the consultant opens the form", async () => {
    const owner = await db.createUser("form-istek@example.com", { first_name: "Form", last_name: "İstek" });
    const app = await createDraft(owner);
    await submit(owner, app);
    await db.asUser(staff, (s) => s.run("update public.applications set form_locked = true where id = $1", [app]));

    expect(await rejection(db.asService((s) => s.run(request, [bob, app, "Adresimi değiştirmek istiyorum."])))).toMatch(/forbidden/);
    expect(await rejection(db.asService((s) => s.run(request, [owner, app, "x".repeat(1001)])))).toMatch(/form_edit_note_invalid/);
    await db.asService((s) => s.run(request, [owner, app, "  Adresimi değiştirmek istiyorum.  "]));
    expect(await row(app)).toMatchObject({ form_locked: true, form_edit_request_note: "Adresimi değiştirmek istiyorum." });
    expect((await row(app)).form_edit_requested_at).not.toBeNull();
    expect(await rejection(db.asService((s) => s.run(request, [owner, app, "İkinci istek"])))).toMatch(/form_edit_already_requested/);
    // The request text is not written to the audit log.
    const [audit] = await db.admin<{ actor_id: string; details: Record<string, unknown> }>(
      "select actor_id, details from public.audit_log where application_id = $1 and action = 'form.edit_requested'",
      [app],
    );
    expect(audit).toEqual({ actor_id: owner, details: {} });

    // When the consultant opens the form for editing, the request counts as fulfilled.
    await db.asUser(staff, (s) => s.run("update public.applications set form_locked = false where id = $1", [app]));
    expect(await row(app)).toMatchObject({ form_locked: false, form_edit_requested_at: null, form_edit_request_note: null });
    // A request cannot be sent if the form is already open.
    expect(await rejection(db.asService((s) => s.run(request, [owner, app, "Yeni istek"])))).toMatch(/form_already_open/);
  });

  it("a request can be sent without a note (migration 22); an empty note is stored as NULL", async () => {
    const owner = await db.createUser("form-istek-notsuz@example.com", { first_name: "Form", last_name: "Notsuz" });
    const app = await createDraft(owner);
    await submit(owner, app);
    await db.asUser(staff, (s) => s.run("update public.applications set form_locked = true where id = $1", [app]));
    await db.asService((s) => s.run(request, [owner, app, "   "]));
    expect(await row(app)).toMatchObject({ form_locked: true, form_edit_request_note: null });
    expect((await row(app)).form_edit_requested_at).not.toBeNull();
    // A request without a note cannot be sent on someone else's behalf either.
    expect(await rejection(db.asService((s) => s.run(request, [bob, app, null])))).toMatch(/forbidden/);
  });

  it("the consultant can refuse the request (closing it); the customer cannot close the request themselves", async () => {
    const owner = await db.createUser("form-istek-red@example.com", { first_name: "Form", last_name: "Red" });
    const app = await createDraft(owner);
    await submit(owner, app);
    await db.asUser(staff, (s) => s.run("update public.applications set form_locked = true where id = $1", [app]));
    await db.asService((s) => s.run(request, [owner, app, "Telefon numaram değişti."]));
    expect(await rejection(db.asUser(owner, (s) => s.run("update public.applications set form_edit_requested_at = null where id = $1", [app])))).toMatch(DENIED);
    expect(
      await db.asUser(staff, (s) => s.run("update public.applications set form_edit_requested_at = null, form_edit_request_note = null where id = $1", [app])),
    ).toBe(1);
    expect(await row(app)).toMatchObject({ form_locked: true, form_edit_requested_at: null });
    // A request cannot be sent for an application awaiting its result (appointment passed).
    await db.admin("update public.applications set payment_status = 'verified', appointment_status = 'completed' where id = $1", [app]);
    expect((await row(app)).status).toBe("awaiting_result");
    expect(await rejection(db.asService((s) => s.run(request, [owner, app, "Geç istek"])))).toMatch(/form_edit_request_not_allowed/);
  });

  it("'Formu düzenlemeyi tamamladım' locks the form and the application returns to review by itself", async () => {
    const owner = await db.createUser("form-tamam@example.com", { first_name: "Form", last_name: "Tamam" });
    const app = await createDraft(owner);
    await submit(owner, app);
    await db.asUser(staff, (s) => s.run("update public.applications set payment_status = 'verified' where id = $1", [app]));
    await db.asUser(staff, (s) => s.run("update public.applications set form_locked = false where id = $1", [app]));
    expect(await row(app)).toMatchObject({ status: "awaiting_customer", form_locked: false });

    expect(await rejection(db.asService((s) => s.run(finish, [bob, app])))).toMatch(/forbidden/);
    await db.asService((s) => s.run(finish, [owner, app]));
    expect(await row(app)).toMatchObject({ status: "in_review", form_locked: true });
    expect(await rejection(db.asService((s) => s.run(finish, [owner, app])))).toMatch(/form_correction_not_open/);
    const [audit] = await db.admin<{ actor_id: string }>("select actor_id from public.audit_log where application_id = $1 and action = 'form.correction_finished'", [app]);
    expect(audit).toEqual({ actor_id: owner });
  });

  it("sessions cannot call the functions directly", async () => {
    const calls = [(s: Session) => s.run(request, [alice, aliceApp, "x"]), (s: Session) => s.run(finish, [alice, aliceApp])];
    for (const run of calls) {
      expect(await rejection(db.asUser(alice, run))).toMatch(/permission denied/i);
      expect(await rejection(db.asUser(staff, run))).toMatch(/permission denied/i);
      expect(await rejection(db.asAnon(run))).toMatch(/permission denied/i);
    }
  });

  it("the map link of an appointment location can only be an https address; staff write a copy to the application", async () => {
    expect(
      await rejection(db.asUser(staff, (s) => s.run("insert into public.appointment_locations (name, address, maps_url) values ('TEST Yer', 'TEST Adres', 'javascript:alert(1)')"))),
    ).toMatch(/check constraint/i);
    const [location] = await db.asUser(staff, (s) =>
      s.query<{ id: string }>("insert into public.appointment_locations (name, address, maps_url) values ('TEST Harita Yeri', 'TEST Adres', 'https://maps.app.goo.gl/ornek') returning id"),
    );
    expect(location!.id).toBeTruthy();
    const owner = await db.createUser("harita@example.com", { first_name: "Harita", last_name: "Test" });
    const app = await createDraft(owner);
    await submit(owner, app);
    expect(await db.asUser(staff, (s) => s.run("update public.applications set appointment_maps_url = 'https://maps.app.goo.gl/ornek' where id = $1", [app]))).toBe(1);
    expect(await rejection(db.asUser(staff, (s) => s.run("update public.applications set appointment_maps_url = 'http://ornek.com' where id = $1", [app])))).toMatch(/check constraint/i);
    expect(await db.asUser(owner, (s) => s.query("select appointment_maps_url from public.applications where id = $1", [app]))).toEqual([
      { appointment_maps_url: "https://maps.app.goo.gl/ornek" },
    ]);
  });

  it("the e-mail logo bucket is public and only accepts PNG; there is no write policy for sessions", async () => {
    const [bucket] = await db.admin<{ public: boolean; allowed_mime_types: string[]; file_size_limit: number }>(
      "select public, allowed_mime_types, file_size_limit from storage.buckets where id = 'brand'",
    );
    expect(bucket).toEqual({ public: true, allowed_mime_types: ["image/png"], file_size_limit: 524288 });
    const policies = await db.admin("select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual like '%brand%' or with_check like '%brand%')");
    expect(policies).toEqual([]);
    expect(await rejection(db.asUser(alice, (s) => s.run("insert into storage.objects (bucket_id, name) values ('brand', 'sahte.png')")))).toMatch(DENIED);
    // The application files bucket stays private.
    expect(await db.admin("select public from storage.buckets where id = 'application-files'")).toEqual([{ public: false }]);
  });
});

describe("staff admin (migration 18)", () => {
  const access = "select public.svc_set_staff_access($1, $2, $3, $4)";
  const setAdmin = "select public.svc_set_staff_admin($1, $2, $3)";
  const isAdmin = async (id: string) => (await db.admin<{ is_admin: boolean }>("select is_admin from public.profiles where id = $1", [id]))[0]!.is_admin;
  let normal: string;
  let other: string;

  beforeAll(async () => {
    normal = await db.createUser("normal-personel@example.com", { first_name: "Normal", last_name: "Personel" });
    other = await db.createUser("diger-personel@example.com", { first_name: "Diğer", last_name: "Personel" });
    await db.makeStaff(normal);
    await db.makeStaff(other);
  });

  it("staff who are not admins cannot invite, enable/disable access, grant admin rights or reset authentication", async () => {
    const newcomer = await db.createUser("yonetici-olmayan-davet@example.com", { first_name: "Davet", last_name: "Edilen" });
    expect(await rejection(db.asService((s) => s.run(access, [normal, newcomer, "staff", true])))).toMatch(/admin_required/);
    expect(await rejection(db.asService((s) => s.run(access, [normal, other, "staff", false])))).toMatch(/admin_required/);
    expect(await rejection(db.asService((s) => s.run(setAdmin, [normal, normal, true])))).toMatch(/admin_required/);
    expect(
      await rejection(db.asService((s) => s.run("select public.svc_record_staff_security_event($1, 'staff.mfa_reset', $2)", [normal, other]))),
    ).toMatch(/admin_required/);
    // A former admin whose access was disabled cannot do it either.
    await db.admin("update public.profiles set is_admin = true where id = $1", [exStaff]);
    expect(await rejection(db.asService((s) => s.run(setAdmin, [exStaff, other, true])))).toMatch(/admin_required/);
    await db.admin("update public.profiles set is_admin = false where id = $1", [exStaff]);
    expect(await isAdmin(other)).toBe(false);
  });

  it("an admin grants and revokes admin rights; the change is recorded under the admin's name; cannot remove their own admin rights", async () => {
    await db.asService((s) => s.run(setAdmin, [staff, other, true]));
    expect(await isAdmin(other)).toBe(true);
    const [audit] = await db.admin<{ actor_id: string; details: { admin_to: boolean } }>(
      "select actor_id, details from public.audit_log where action = 'staff.admin_changed' and entity_id = $1 order by id desc limit 1",
      [other],
    );
    expect(audit).toEqual({ actor_id: staff, details: { admin_to: true } });
    await db.asService((s) => s.run(setAdmin, [staff, other, false]));
    expect(await isAdmin(other)).toBe(false);
    expect(await rejection(db.asService((s) => s.run(setAdmin, [staff, staff, false])))).toMatch(/cannot_change_own_access/);
    // A customer cannot be made an admin.
    expect(await rejection(db.asService((s) => s.run(setAdmin, [staff, alice, true])))).toMatch(/not_found/);
  });

  it("removing staff rights also removes admin rights; the setup script (empty actor) can appoint an admin", async () => {
    const temp = await db.createUser("gecici-yonetici@example.com", { first_name: "Geçici", last_name: "Yönetici" });
    await db.asService((s) => s.run(access, [staff, temp, "staff", true]));
    await db.asService((s) => s.run(setAdmin, [null, temp, true]));
    expect(await isAdmin(temp)).toBe(true);
    await db.asService((s) => s.run(access, [staff, temp, "customer", true]));
    expect(await isAdmin(temp)).toBe(false);
  });

  it("sessions cannot write the admin column or call the function directly", async () => {
    for (const user of [alice, normal, staff]) {
      expect(await rejection(db.asUser(user, (s) => s.run("update public.profiles set is_admin = true where id = $1", [user])))).toMatch(/permission denied/i);
      expect(await rejection(db.asUser(user, (s) => s.run(setAdmin, [user, user, true])))).toMatch(/permission denied/i);
    }
    expect(await rejection(db.asAnon((s) => s.run(setAdmin, [staff, staff, true])))).toMatch(/permission denied/i);
    expect(await isAdmin(normal)).toBe(false);
  });
});

describe("document rules by application type combination (migration 20)", () => {
  const slots = async (applicationId: string) =>
    db.admin<{ document_type_id: string; requirement: string; allow_not_applicable: boolean; out_of_scope: boolean }>(
      "select document_type_id, requirement, allow_not_applicable, out_of_scope from public.application_documents where application_id = $1 and document_type_id like 'kural_%' order by document_type_id",
      [applicationId],
    );
  const saveRule = (types: string[], sponsor: string | null, items: { document_type_id: string; requirement: string }[]) =>
    db.asUser(staff, (s) => s.query<{ id: string }>("select public.save_document_rule(null, $1::text[], $2, $3::jsonb) as id", [types, sponsor, JSON.stringify(items)]));

  beforeAll(async () => {
    await db.asUser(staff, (s) =>
      s.run("insert into public.document_types (id, label) values ('kural_ogrenci_sponsor', 'Kombinasyon belgesi'), ('kural_ortak', 'Kural ortak belge')"),
    );
  });

  it("existing groups were converted to rules: a student application gets the passport and student documents", async () => {
    const [student] = await db.admin<{ n: number }>(
      "select count(*)::int as n from public.document_rules r join public.document_rule_items i on i.rule_id = r.id where r.application_types = array['student']",
    );
    expect(student!.n).toBeGreaterThan(0);
    const [common] = await db.admin<{ has_passport: boolean }>(
      "select exists (select 1 from public.document_rules r join public.document_rule_items i on i.rule_id = r.id where r.application_types = '{}' and i.document_type_id = 'passport') as has_passport",
    );
    expect(common!.has_passport).toBe(true);
  });

  it("a combination rule only applies if all types in the rule are selected; the strictest rule wins", async () => {
    await saveRule(["sponsored", "student"], null, [{ document_type_id: "kural_ogrenci_sponsor", requirement: "optional" }]);
    // The same document optional in the shared rule and required in a combination: it becomes required in the combination.
    await db.asUser(staff, (s) =>
      s.run(
        "insert into public.document_rule_items (rule_id, document_type_id, requirement) select id, 'kural_ortak', 'optional' from public.document_rules where application_types = '{}'",
      ),
    );
    await db.asUser(staff, (s) =>
      s.run(
        "insert into public.document_rule_items (rule_id, document_type_id, requirement) select id, 'kural_ortak', 'required' from public.document_rules where application_types = array['sponsored', 'student']",
      ),
    );

    const owner = await db.createUser("kural-kombinasyon@example.com", { first_name: "Kural", last_name: "Kombinasyon" });
    const app = await createDraft(owner);
    await db.asUser(owner, (s) => s.run("update public.applications set application_types = array['student'] where id = $1", [app]));
    await db.asUser(owner, (s) => s.run("select public.sync_application_documents($1)", [app]));
    expect(await slots(app)).toEqual([{ document_type_id: "kural_ortak", requirement: "optional", allow_not_applicable: false, out_of_scope: false }]);

    await db.asUser(owner, (s) => s.run("update public.applications set application_types = array['student', 'sponsored'], sponsor_status = 'employee' where id = $1", [app]));
    await db.asUser(owner, (s) => s.run("select public.sync_application_documents($1)", [app]));
    expect(await slots(app)).toEqual([
      { document_type_id: "kural_ogrenci_sponsor", requirement: "optional", allow_not_applicable: false, out_of_scope: false },
      { document_type_id: "kural_ortak", requirement: "required", allow_not_applicable: false, out_of_scope: false },
    ]);
    // The "Koşullu" rule can no longer be written (migration 26).
    expect(
      await rejection(
        db.asUser(staff, (s) =>
          s.run(
            "update public.document_rule_items set requirement = 'conditional' where document_type_id = 'kural_ortak' and rule_id in (select id from public.document_rules where application_types = '{}')",
          ),
        ),
      ),
    ).toMatch(/check constraint/i);

    // When the combination is removed the empty slot is deleted.
    await db.asUser(owner, (s) => s.run("update public.applications set application_types = array['student'], sponsor_status = null where id = $1", [app]));
    await db.asUser(owner, (s) => s.run("select public.sync_application_documents($1)", [app]));
    expect((await slots(app)).map((r) => r.document_type_id)).toEqual(["kural_ortak"]);
  });

  it("the same combination cannot be defined twice (type order does not matter); sponsor status only in a sponsored rule", async () => {
    expect(await rejection(saveRule(["student", "sponsored"], null, []))).toMatch(/duplicate key|unique/i);
    expect(await rejection(saveRule(["student"], "employee", []))).toMatch(/check constraint/i);
    expect(await rejection(saveRule(["bilinmeyen"], null, []))).toMatch(/check constraint/i);
  });

  it("customers and former staff cannot see or change the rules or call the function", async () => {
    for (const user of [alice, exStaff]) {
      expect(await db.asUser(user, (s) => s.query("select id from public.document_rules"))).toEqual([]);
      expect(await db.asUser(user, (s) => s.query("select id from public.document_rule_items"))).toEqual([]);
      expect(await rejection(db.asUser(user, (s) => s.run("insert into public.document_rules (application_types) values (array['retired'])")))).toMatch(DENIED);
      expect(await db.asUser(user, (s) => s.run("delete from public.document_rule_items"))).toBe(0);
      expect(await rejection(db.asUser(user, (s) => s.query("select public.save_document_rule(null, array['retired'], null, '[]'::jsonb)")))).toMatch(/forbidden/);
    }
    expect(await rejection(db.asAnon((s) => s.query("select id from public.document_rules")))).toMatch(/permission denied/i);
  });
});

describe("personel silme (21. dosya)", () => {
  const remove = "select public.svc_delete_staff($1, $2)";
  let leaving: string;
  let leavingApp: string;

  beforeAll(async () => {
    leaving = await db.createUser("ayrilan-personel@example.com", { first_name: "Ayrılan", last_name: "Personel" });
    await db.makeStaff(leaving);
    leavingApp = await createDraft(alice);
  });

  it("non-admins, disabled accounts and an empty actor cannot delete; nobody can delete themselves; a customer cannot be deleted this way", async () => {
    const normal = await db.createUser("silemeyen-personel@example.com", { first_name: "Silemeyen", last_name: "Personel" });
    await db.makeStaff(normal);
    expect(await rejection(db.asService((s) => s.run(remove, [normal, leaving])))).toMatch(/admin_required/);
    expect(await rejection(db.asService((s) => s.run(remove, [exStaff, leaving])))).toMatch(/admin_required/);
    expect(await rejection(db.asService((s) => s.run(remove, [null, leaving])))).toMatch(/admin_required/);
    expect(await rejection(db.asService((s) => s.run(remove, [staff, staff])))).toMatch(/cannot_change_own_access/);
    expect(await rejection(db.asService((s) => s.run(remove, [staff, alice])))).toMatch(/not_found/);
  });

  it("sessions cannot call the function; staff cannot write a name label when adding a note", async () => {
    for (const user of [alice, staff]) {
      expect(await rejection(db.asUser(user, (s) => s.run(remove, [staff, leaving])))).toMatch(/permission denied/i);
    }
    expect(await rejection(db.asAnon((s) => s.run(remove, [staff, leaving])))).toMatch(/permission denied/i);
    expect(
      await rejection(
        db.asUser(staff, (s) =>
          s.run("insert into public.staff_notes (application_id, author_id, body, author_label) values ($1, $2, 'Not', 'Sahte ad')", [leavingApp, staff]),
        ),
      ),
    ).toMatch(DENIED);
  });

  it("a deleted staff member loses access; once the account is deleted their name stays in the audit log and internal notes", async () => {
    await db.asUser(leaving, (s) => s.run("insert into public.staff_notes (application_id, author_id, body) values ($1, $2, 'Ayrılmadan önce not')", [leavingApp, leaving]));
    await db.admin("insert into public.audit_log (actor_id, action, application_id) values ($1, 'note.added', $2)", [leaving, leavingApp]);

    await db.asService((s) => s.run(remove, [staff, leaving]));
    const [profile] = await db.admin<{ is_active: boolean; is_admin: boolean }>("select is_active, is_admin from public.profiles where id = $1", [leaving]);
    expect(profile).toEqual({ is_active: false, is_admin: false });
    const [deleted] = await db.admin<{ actor_id: string; entity_id: string }>(
      "select actor_id, entity_id from public.audit_log where action = 'staff.deleted' order by id desc limit 1",
    );
    expect(deleted).toEqual({ actor_id: staff, entity_id: leaving });

    // The app then deletes the identity account; profile and links are cleared, the name label remains.
    await db.admin("delete from auth.users where id = $1", [leaving]);
    const notes = await db.admin<{ author_id: string | null; author_label: string }>("select author_id, author_label from public.staff_notes where application_id = $1", [leavingApp]);
    expect(notes).toEqual([{ author_id: null, author_label: "Ayrılan Personel (silinmiş personel)" }]);
    const [audit] = await db.admin<{ actor_id: string | null; actor_label: string }>(
      "select actor_id, actor_label from public.audit_log where action = 'note.added' and application_id = $1",
      [leavingApp],
    );
    expect(audit).toEqual({ actor_id: null, actor_label: "Ayrılan Personel (silinmiş personel)" });
  });
});

describe("two-factor authentication recovery code (migration 23)", () => {
  const set = "select public.svc_set_staff_recovery_code($1, $2)";
  const use = "select public.svc_use_staff_recovery_code($1, $2) as ok";
  const createdAt = "select public.svc_staff_recovery_code_created_at($1) as at";
  const hash = (n: number) => n.toString(16).padStart(64, "0");

  it("no session can read the table or call the functions", async () => {
    for (const user of [alice, staff]) {
      expect(await rejection(db.asUser(user, (s) => s.query("select * from private.staff_recovery_codes")))).toMatch(/permission denied/i);
      expect(await rejection(db.asUser(user, (s) => s.run(set, [user, hash(1)])))).toMatch(/permission denied/i);
      expect(await rejection(db.asUser(user, (s) => s.query(use, [user, hash(1)])))).toMatch(/permission denied/i);
      expect(await rejection(db.asUser(user, (s) => s.query(createdAt, [user])))).toMatch(/permission denied/i);
    }
  });

  it("active staff only; the digest format is checked", async () => {
    expect(await rejection(db.asService((s) => s.run(set, [alice, hash(1)])))).toMatch(/not_staff/);
    expect(await rejection(db.asService((s) => s.run(set, [exStaff, hash(1)])))).toMatch(/not_staff/);
    expect(await rejection(db.asService((s) => s.run(set, [staff, "kisa"])))).toMatch(/invalid_code_hash/);
    expect(await rejection(db.asService((s) => s.query(use, [alice, hash(1)])))).toMatch(/not_staff/);
  });

  it("a correct code works once; a wrong code is recorded; after 5 wrong attempts there is a wait; a renewed code invalidates the old one", async () => {
    const person = await db.createUser("yedek-kod@example.com", { first_name: "Yedek", last_name: "Kod" });
    await db.makeStaff(person);
    expect(await db.asService((s) => s.query(createdAt, [person]))).toEqual([{ at: null }]);

    await db.asService((s) => s.run(set, [person, hash(1)]));
    expect((await db.asService((s) => s.query<{ at: string | null }>(createdAt, [person])))[0]!.at).not.toBeNull();
    // After renewal the old code no longer works.
    await db.asService((s) => s.run(set, [person, hash(2)]));
    expect(await db.asService((s) => s.query(use, [person, hash(1)]))).toEqual([{ ok: false }]);
    // The correct code works once, then it is deleted.
    expect(await db.asService((s) => s.query(use, [person, hash(2)]))).toEqual([{ ok: true }]);
    expect(await db.asService((s) => s.query(use, [person, hash(2)]))).toEqual([{ ok: false }]);
    expect(await db.asService((s) => s.query(createdAt, [person]))).toEqual([{ at: null }]);

    // 2 wrong attempts so far; 3 more wrong → then it is not tried at all (even with the correct code).
    await db.asService((s) => s.run(set, [person, hash(3)]));
    for (let i = 0; i < 3; i++) expect(await db.asService((s) => s.query(use, [person, hash(9)]))).toEqual([{ ok: false }]);
    expect(await rejection(db.asService((s) => s.query(use, [person, hash(3)])))).toMatch(/too_many_attempts/);

    // Audit entry: the code or its digest is never written.
    const audit = await db.admin<{ action: string; details: Record<string, unknown> }>(
      "select action, details from public.audit_log where actor_id = $1 and action like 'staff.recovery_code%' order by id",
      [person],
    );
    expect(audit.map((a) => a.action)).toEqual([
      "staff.recovery_code_created",
      "staff.recovery_code_created",
      "staff.recovery_code_failed",
      "staff.recovery_code_used",
      "staff.recovery_code_failed",
      "staff.recovery_code_created",
      "staff.recovery_code_failed",
      "staff.recovery_code_failed",
      "staff.recovery_code_failed",
    ]);
    expect(audit.every((a) => Object.keys(a.details).length === 0)).toBe(true);
  });
});

describe("acceptance of the application terms of service (migration 24)", () => {
  const read = "select application_id, customer_id, terms_version from public.application_terms_acceptances where application_id = $1";

  it("a draft cannot be submitted without accepting the terms; the acceptance is stored with its version and written to the audit log", async () => {
    const owner = await db.createUser("sartlar@example.com", { first_name: "Şartlar", last_name: "Müşteri" });
    const app = await createDraft(owner);
    await db.asService((s) =>
      s.run("select public.svc_set_appointment_preferences($1, $2, $3::jsonb)", [owner, app, JSON.stringify([{ date: "2026-10-20", slot: "morning" }])]),
    );
    expect(await rejection(db.asService((s) => s.run("select public.svc_submit_application($1, $2, '[]'::jsonb)", [owner, app])))).toMatch(
      /terms_not_accepted/,
    );
    expect(await rejection(db.asService((s) => s.run(ACCEPT_TERMS, [bob, app, TERMS_VERSION])))).toMatch(/forbidden/);
    expect(await rejection(db.asService((s) => s.run(ACCEPT_TERMS, [owner, app, "son sürüm"])))).toMatch(/invalid_terms_version/);
    await db.asService((s) => s.run(ACCEPT_TERMS, [owner, app, TERMS_VERSION]));
    await db.asService((s) => s.run("select public.svc_submit_application($1, $2, '[]'::jsonb)", [owner, app]));
    expect(await db.admin(read, [app])).toEqual([{ application_id: app, customer_id: owner, terms_version: TERMS_VERSION }]);
    // The acceptance cannot be changed on a submitted application.
    expect(await rejection(db.asService((s) => s.run(ACCEPT_TERMS, [owner, app, "2027-01-01"])))).toMatch(/application_not_editable/);
    const [audit] = await db.admin<{ actor_id: string; details: Record<string, unknown> }>(
      "select actor_id, details from public.audit_log where application_id = $1 and action = 'application.terms_accepted'",
      [app],
    );
    expect(audit).toEqual({ actor_id: owner, details: { version: TERMS_VERSION } });
  });

  it("a customer reads only their own record, no session can write; staff read; sessions cannot call the function", async () => {
    const owner = await db.createUser("sartlar-okuma@example.com", { first_name: "Şartlar", last_name: "Okuma" });
    const app = await createDraft(owner);
    await submit(owner, app);
    expect(await db.asUser(owner, (s) => s.query(read, [app]))).toHaveLength(1);
    expect(await db.asUser(bob, (s) => s.query(read, [app]))).toHaveLength(0);
    expect(await db.asUser(staff, (s) => s.query(read, [app]))).toHaveLength(1);
    expect(await db.asUser(exStaff, (s) => s.query(read, [app]))).toHaveLength(0);
    for (const user of [owner, staff]) {
      expect(
        await rejection(
          db.asUser(user, (s) =>
            s.run("insert into public.application_terms_acceptances (application_id, customer_id, terms_version) values ($1, $2, '2026-10-23')", [app, owner]),
          ),
        ),
      ).toMatch(DENIED);
      expect(await rejection(db.asUser(user, (s) => s.run("update public.application_terms_acceptances set accepted_at = now() where application_id = $1", [app])))).toMatch(
        DENIED,
      );
      expect(await rejection(db.asUser(user, (s) => s.run("delete from public.application_terms_acceptances where application_id = $1", [app])))).toMatch(DENIED);
      expect(await rejection(db.asUser(user, (s) => s.run(ACCEPT_TERMS, [owner, app, TERMS_VERSION])))).toMatch(/permission denied/i);
    }
  });
});

describe("extra documents after submission (migration 26)", () => {
  let gina: string;
  let app: string;
  const fileId = (n: number) => `abababab-abab-4bab-8bab-${String(n).padStart(12, "0")}`;
  const insertExtra = (id: string, applicationId: string, status: "pending" | "ready") =>
    db.asService((s) =>
      s.run(
        `insert into public.application_files (id, application_id, kind, storage_path, original_name, mime_type, size_bytes, status, uploaded_by)
         values ($1, $2, 'extra_document', $3, 'ek.pdf', 'application/pdf', 1024, $4, $5)`,
        [id, applicationId, `${applicationId}/${id}.pdf`, status, gina],
      ),
    );
  const setLimit = (value: string) => db.admin("update public.settings set value = $1::jsonb where key = 'documents.extra_max'", [value]);

  beforeAll(async () => {
    gina = await db.createUser("ek-evrak@example.com", { first_name: "Gina", last_name: "Test" });
    app = await createDraft(gina);
  });

  it("no extra documents can be added to a draft", async () => {
    expect(await rejection(insertExtra(fileId(1), app, "pending"))).toMatch(/extra_document_not_allowed/);
  });

  it("added to a submitted application up to the limit; the limit changes in Settings, 0 disables it", async () => {
    await submit(gina, app);
    const [setting] = await db.admin<{ value: number; visibility: string }>("select value, visibility from public.settings where key = 'documents.extra_max'");
    expect(setting).toEqual({ value: 10, visibility: "customer" });

    await setLimit("2");
    await insertExtra(fileId(2), app, "ready");
    await insertExtra(fileId(3), app, "ready");
    expect(await rejection(insertExtra(fileId(4), app, "ready"))).toMatch(/extra_document_limit/);
    // A pending upload record can be opened but cannot be verified while the limit is reached (simultaneous uploads cannot exceed the limit).
    await insertExtra(fileId(5), app, "pending");
    expect(await rejection(db.asService((s) => s.run("update public.application_files set status = 'ready' where id = $1", [fileId(5)])))).toMatch(
      /extra_document_limit/,
    );
    await setLimit("3");
    await db.asService((s) => s.run("update public.application_files set status = 'ready' where id = $1", [fileId(5)]));
    await setLimit("0");
    expect(await rejection(insertExtra(fileId(6), app, "ready"))).toMatch(/extra_document_limit/);
    // A non-numeric value (setting left empty) counts as the default of 10.
    await setLimit('""');
    await insertExtra(fileId(6), app, "ready");
    await setLimit("10");
  });

  it("a customer sees their own extra documents; another customer cannot; nobody can write records", async () => {
    const own = await db.asUser(gina, (s) => s.query("select id from public.application_files where application_id = $1 and kind = 'extra_document'", [app]));
    expect(own).toHaveLength(4);
    expect(await db.asUser(alice, (s) => s.query("select id from public.application_files where application_id = $1", [app]))).toEqual([]);
    expect(
      await rejection(
        db.asUser(gina, (s) =>
          s.run(
            `insert into public.application_files (application_id, kind, storage_path, original_name, mime_type, size_bytes)
             values ($1, 'extra_document', $2, 'x.pdf', 'application/pdf', 1)`,
            [app, `${app}/${fileId(7)}.pdf`],
          ),
        ),
      ),
    ).toMatch(DENIED);
  });

  it("no extra documents can be added to a cancelled application or one whose result was sent", async () => {
    await db.asUser(staff, (s) => s.run("update public.applications set status = 'cancelled' where id = $1", [app]));
    expect(await rejection(insertExtra(fileId(8), app, "pending"))).toMatch(/extra_document_not_allowed/);
  });

  it("no session can call the limit function directly", async () => {
    for (const who of [gina, staff]) {
      expect(await rejection(db.asUser(who, (s) => s.run("select private.extra_document_limit()")))).toMatch(/permission denied/i);
    }
  });
});

describe("admin deleting an application (migration 27)", () => {
  const DELETE = "select * from public.svc_delete_application($1, $2)";
  let admin: string;
  let plainStaff: string;
  let owner: string;
  let submitted: string;
  let draft: string;
  const fileId = "cdcdcdcd-cdcd-4dcd-8dcd-000000000001";

  beforeAll(async () => {
    admin = await db.createUser("silen-yonetici@example.com", { first_name: "Silen", last_name: "Yönetici" });
    await db.makeStaff(admin, true, true);
    plainStaff = await db.createUser("silemeyen@example.com", { first_name: "Sıradan", last_name: "Danışman" });
    await db.makeStaff(plainStaff, true, false);
    owner = await db.createUser("silinecek@example.com", { first_name: "Silinecek", last_name: "Müşteri" });
    draft = await createDraft(owner);
    submitted = await createDraft(owner);
    await submit(owner, submitted);
    await db.asService((s) =>
      s.run(
        `insert into public.application_files (id, application_id, kind, storage_path, original_name, mime_type, size_bytes, status, uploaded_by)
         values ($1, $2, 'payment_receipt', $3, 'dekont.pdf', 'application/pdf', 1024, 'ready', $4)`,
        [fileId, submitted, `${submitted}/${fileId}.pdf`, owner],
      ),
    );
    await db.admin("insert into public.application_messages (application_id, author_id, body) values ($1, $2, 'mesaj')", [submitted, staff]);
    await db.admin("insert into public.staff_notes (application_id, author_id, body) values ($1, $2, 'not')", [submitted, staff]);
    await db.admin("insert into public.customer_tasks (application_id, title, created_by) values ($1, 'görev', $2)", [submitted, staff]);
  });

  it("non-admin staff, customers and non-staff cannot delete", async () => {
    for (const actor of [plainStaff, owner, alice]) {
      expect(await rejection(db.asService((s) => s.run(DELETE, [actor, submitted])))).toMatch(/admin_required/);
    }
    await db.makeStaff(admin, false, true);
    expect(await rejection(db.asService((s) => s.run(DELETE, [admin, submitted])))).toMatch(/admin_required/);
    await db.makeStaff(admin, true, true);
    expect(await db.admin("select id from public.applications where id = $1", [submitted])).toHaveLength(1);
  });

  it("sessions cannot call the function directly", async () => {
    for (const user of [admin, owner]) {
      expect(await rejection(db.asUser(user, (s) => s.run(DELETE, [user, submitted])))).toMatch(/permission denied/i);
    }
    expect(await rejection(db.asAnon((s) => s.run(DELETE, [admin, submitted])))).toMatch(/permission denied/i);
  });

  it("an admin deletes a submitted application with its related records; file paths are returned and the number stays in the audit log", async () => {
    const [{ reference_code: reference }] = (await db.admin<{ reference_code: string }>("select reference_code from public.applications where id = $1", [submitted])) as [
      { reference_code: string },
    ];
    const paths = await db.asService((s) => s.query<{ svc_delete_application: string }>(DELETE, [admin, submitted]));
    expect(paths.map((r) => r.svc_delete_application)).toEqual([`${submitted}/${fileId}.pdf`]);
    for (const table of ["applications", "application_files", "application_messages", "staff_notes", "customer_tasks", "application_terms_acceptances"]) {
      const column = table === "applications" ? "id" : "application_id";
      expect(await db.admin(`select 1 from public.${table} where ${column} = $1`, [submitted]), table).toEqual([]);
    }
    const audit = await db.admin<{ actor_id: string; application_id: string | null; details: Record<string, unknown> }>(
      "select actor_id, application_id, details from public.audit_log where action = 'application.deleted' and entity_id = $1",
      [submitted],
    );
    expect(audit).toEqual([{ actor_id: admin, application_id: null, details: { reference_code: reference, status: "submitted" } }]);
    // The customer's account remains.
    expect(await db.admin("select id from public.profiles where id = $1", [owner])).toHaveLength(1);
  });

  it("a draft is deleted too; not_found for an application that does not exist", async () => {
    await db.asService((s) => s.run(DELETE, [admin, draft]));
    expect(await db.admin("select id from public.applications where id = $1", [draft])).toEqual([]);
    expect(await rejection(db.asService((s) => s.run(DELETE, [admin, draft])))).toMatch(/not_found/);
  });
});
