-- =============================================================================
-- Vize Başvuru Portalı — full installation of the LIVE project (GENERATED FILE, do not edit by hand)
-- =============================================================================
-- 27 migration files in order. Run ONCE in the SQL Editor of an EMPTY, NEW Supabase project ONLY.
-- Then run supabase/checks/verify-installation.sql: every row must read OK.
-- To regenerate: node scripts/build-full-installation.mjs

-- >>> 20261013000100_schema.sql
-- =============================================================================
-- Vize Başvuru Portalı — schema
-- =============================================================================
-- Tables, constraints and indexes. Grants and RLS policies are in the next
-- migration file (20261013000200_security.sql).
--
-- Even when this file is applied ON ITS OWN the tables are closed: default privileges are revoked
-- at the very start and RLS is enabled at the very end. Until policies are added, anon and authenticated can access nothing.
--
-- Status fields are CHECK-constrained text instead of ENUMs; adding a new value only requires
-- changing the constraint. The values must match src/lib/domain/constants.ts
-- (tests/db/constants.test.ts verifies this).

create schema if not exists private;

-- By default Supabase opens every new table, sequence and function created in the public schema to the
-- anon and authenticated roles. These defaults are revoked BEFORE the tables are created so the tables below
-- are never open, not even for a moment (the security file repeats the same).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- EXECUTE granted to PUBLIC is a global default; it cannot be revoked per schema, so it is revoked globally.
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- User profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  first_name text not null default '' check (char_length(first_name) <= 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  birth_date date,
  -- The 'staff' role is only granted with the service role (scripts/create-staff.mjs or staff management).
  role text not null default 'customer' check (role in ('customer', 'staff')),
  is_active boolean not null default true,
  consents_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'auth.users ile bire bir; rol ve temel kimlik bilgileri.';

-- ---------------------------------------------------------------------------
-- Configuration tables
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{1,60}$'),
  value jsonb not null default 'null'::jsonb check (octet_length(value::text) <= 8000),
  -- public: everyone; customer: signed-in users; staff: staff only
  visibility text not null default 'staff' check (visibility in ('public', 'customer', 'staff')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create table public.zip_categories (
  id uuid primary key default gen_random_uuid(),
  -- The folder name is stored with the company's own spelling; only unsafe names are rejected.
  folder_name text not null unique check (
    char_length(folder_name) between 1 and 60
    and folder_name = btrim(folder_name)
    and folder_name !~ '[\\/:*?"<>|[:cntrl:]]'
    and folder_name not in ('.', '..')
    and right(folder_name, 1) <> '.'
  ),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_types (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,60}$'),
  label text not null check (char_length(label) between 1 and 160),
  description text not null default '' check (char_length(description) <= 600),
  -- NULL: a shared document for all applications
  application_type text check (
    application_type in ('general_employee', 'self_employed', 'retired', 'student', 'uk_family_visit', 'sponsored')
  ),
  -- Only for sponsored applications, for documents required depending on the sponsor's status
  sponsor_status text check (sponsor_status in ('employee', 'retired', 'business_owner')),
  requirement text not null default 'required' check (requirement in ('required', 'conditional', 'optional')),
  allow_not_applicable boolean not null default false,
  max_files integer not null default 10 check (max_files between 1 and 30),
  zip_category_id uuid references public.zip_categories (id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sponsor_status is null or application_type = 'sponsored'),
  -- A required document cannot be marked "not applicable".
  check (not (requirement = 'required' and allow_not_applicable))
);

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  surcharge_amount numeric(12, 2) not null default 0 check (surcharge_amount >= 0),
  surcharge_currency text not null default 'TRY' check (surcharge_currency in ('TRY', 'GBP', 'USD', 'EUR')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fee_items (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 160),
  kind text not null check (kind in ('consultancy', 'visa_fee', 'other')),
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'TRY' check (currency in ('TRY', 'GBP', 'USD', 'EUR')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
create sequence public.application_reference_seq;

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique,
  customer_id uuid not null references public.profiles (id) on delete restrict,

  application_types text[] not null default '{}' check (
    application_types <@ array['general_employee', 'self_employed', 'retired', 'student', 'uk_family_visit', 'sponsored']::text[]
    and coalesce(array_length(application_types, 1), 0) <= 6
  ),
  sponsor_status text check (sponsor_status in ('employee', 'retired', 'business_owner')),
  city_id uuid references public.cities (id) on delete set null,

  -- Overall application status
  status text not null default 'draft' check (
    status in (
      'draft', 'submitted', 'in_review', 'correction_required', 'awaiting_customer',
      'documents_complete', 'visa_submitted', 'awaiting_result', 'result_communicated', 'cancelled'
    )
  ),
  -- While true the customer cannot change form answers (locked at submission, the consultant can open it).
  form_locked boolean not null default false,

  -- Payment status (independent of the overall status)
  payment_status text not null default 'not_due' check (
    payment_status in ('not_due', 'awaiting_payment', 'under_review', 'verified', 'rejected')
  ),
  payment_declared_at timestamptz,
  payment_reviewed_at timestamptz,
  payment_reviewed_by uuid references public.profiles (id) on delete set null,
  -- Explanation shown to the customer (e.g. why the payment could not be verified)
  payment_note text check (char_length(payment_note) <= 1000),

  -- Appointment status (independent of the overall status)
  appointment_status text not null default 'not_started' check (
    appointment_status in (
      'not_started', 'preferences_submitted', 'preferences_requested', 'booking_in_progress', 'scheduled', 'completed'
    )
  ),
  appointment_at timestamptz,
  appointment_location text check (char_length(appointment_location) <= 300),
  appointment_note text check (char_length(appointment_note) <= 1000),

  submitted_at timestamptz,
  fees_snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (sponsor_status is null or 'sponsored' = any (application_types)),
  check (status = 'draft' or submitted_at is not null)
);
create index applications_customer_idx on public.applications (customer_id);
create index applications_status_idx on public.applications (status, updated_at desc);

-- Form answers are stored per section; each section is saved independently.
create table public.application_form_sections (
  application_id uuid not null references public.applications (id) on delete cascade,
  section_id text not null check (
    section_id in ('personal', 'contact', 'passport', 'employment', 'travel', 'family', 'history', 'security', 'additional')
  ),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 60000),
  updated_at timestamptz not null default now(),
  primary key (application_id, section_id)
);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
-- A "slot" for every document required in an application. Files are in the application_files table.
create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  -- If NULL it is a custom document request added by hand by the consultant.
  document_type_id text references public.document_types (id) on delete restrict,
  custom_label text check (char_length(custom_label) between 1 and 160),
  custom_description text check (char_length(custom_description) <= 600),
  -- The rule at the moment the slot was created (stays fixed in the application even if the document type changes later).
  requirement text not null default 'required' check (requirement in ('required', 'conditional', 'optional')),
  allow_not_applicable boolean not null default false,
  max_files integer not null default 10 check (max_files between 1 and 30),
  -- A slot that is no longer required because the customer changed the application type, but that contains files.
  out_of_scope boolean not null default false,

  -- The customer's declaration
  not_applicable boolean not null default false,
  not_applicable_reason text check (char_length(not_applicable_reason) <= 500),
  not_applicable_at timestamptz,

  -- The consultant's review
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'needs_correction', 'missing')),
  -- Explanation shown to the customer
  review_note text check (char_length(review_note) <= 1000),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  -- Is the customer allowed to upload files to this slot after submission?
  reupload_allowed boolean not null default false,
  requested_by_staff boolean not null default false,
  -- Document prepared by the company for the customer to download and sign (application_files.id)
  attachment_file_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (application_id, document_type_id),
  check (document_type_id is not null or custom_label is not null),
  check (not (requirement = 'required' and not_applicable))
);
create index application_documents_application_idx on public.application_documents (application_id);

create table public.application_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  application_document_id uuid references public.application_documents (id) on delete cascade,
  kind text not null check (kind in ('document', 'payment_receipt', 'staff_attachment')),
  -- The storage path is generated on the server: "<application uuid>/<file uuid>.<extension>"
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'),
  -- For display only; never used as a file path.
  original_name text not null check (char_length(original_name) between 1 and 160),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 52428800),
  -- pending: upload URL issued, content not verified yet; ready: the server verified the content.
  status text not null default 'pending' check (status in ('pending', 'ready')),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = application_id::text),
  check ((kind = 'document') = (application_document_id is not null))
);
create index application_files_application_idx on public.application_files (application_id);
create index application_files_document_idx on public.application_files (application_document_id);

alter table public.application_documents
  add constraint application_documents_attachment_fk
  foreign key (attachment_file_id) references public.application_files (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Appointment preferences
-- ---------------------------------------------------------------------------
create table public.appointment_preferences (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  rank smallint not null check (rank between 1 and 3),
  preferred_date date not null,
  slot text not null check (slot in ('morning', 'evening')),
  created_at timestamptz not null default now(),
  unique (application_id, rank),
  unique (application_id, preferred_date, slot)
);

-- ---------------------------------------------------------------------------
-- Fee breakdown (a copy of the prices at the moment the application was submitted)
-- ---------------------------------------------------------------------------
create table public.application_fee_items (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 160),
  kind text not null check (kind in ('consultancy', 'visa_fee', 'city_surcharge', 'other')),
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null check (currency in ('TRY', 'GBP', 'USD', 'EUR')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index application_fee_items_application_idx on public.application_fee_items (application_id);

-- ---------------------------------------------------------------------------
-- Communication: messages visible to the customer and notes visible ONLY to staff are in separate tables.
-- ---------------------------------------------------------------------------
create table public.application_messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index application_messages_application_idx on public.application_messages (application_id, created_at);

create table public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index staff_notes_application_idx on public.staff_notes (application_id, created_at);

-- Tasks the consultant gives the customer that are not about uploading documents.
create table public.customer_tasks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 1000),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null
);
create index customer_tasks_application_idx on public.customer_tasks (application_id, status);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z_.]{1,60}$'),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 1000),
  read_at timestamptz,
  -- Reserved for e-mail delivery; stays NULL until a provider is configured.
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

-- ---------------------------------------------------------------------------
-- Audit log. Sensitive content (form answers, ID numbers, file contents) is NEVER WRITTEN.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z_.]{1,80}$'),
  application_id uuid references public.applications (id) on delete set null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb check (octet_length(details::text) <= 4000),
  created_at timestamptz not null default now()
);
create index audit_log_application_idx on public.audit_log (application_id, created_at desc);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS is enabled together with the table. Without policies there is NO access; the policies are in the security file.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.zip_categories enable row level security;
alter table public.document_types enable row level security;
alter table public.cities enable row level security;
alter table public.fee_items enable row level security;
alter table public.applications enable row level security;
alter table public.application_form_sections enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_files enable row level security;
alter table public.appointment_preferences enable row level security;
alter table public.application_fee_items enable row level security;
alter table public.application_messages enable row level security;
alter table public.staff_notes enable row level security;
alter table public.customer_tasks enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- >>> 20261013000200_security.sql
-- =============================================================================
-- Vize Başvuru Portalı — grants, triggers, RLS and storage
-- =============================================================================
--
-- SECURITY MODEL
--
--  * RLS is enabled on every table. Without a policy there is NO access.
--  * A customer (authenticated, role='customer') only READS their own records.
--    The places they can WRITE directly are the ones where the database alone can enforce the rule:
--      - opening a draft application in their own name,
--      - changing the type/sponsor/city fields of a draft application,
--      - saving form sections of an application that is not locked,
--      - marking their own notification as read.
--    Everything that needs business rule validation (submission, payment notice, appointment preference,
--    file record...) goes through svc_* functions the server calls with the service role.
--  * Staff (profiles.role='staff' and is_active) read and manage all applications; their permission is verified
--    in the database on every query with private.is_staff().
--  * Storage (storage.objects): a customer only READS objects in their own application folder;
--    there is no write/delete policy (service role only).

-- ---------------------------------------------------------------------------
-- Helper functions (the private schema cannot be called through the API)
-- ---------------------------------------------------------------------------

-- Is the caller active staff?
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'staff' and p.is_active
  );
$$;

-- Is the request running OUTSIDE an end-user session? (service role, migration, or inside a
-- SECURITY DEFINER function). PostgREST runs end-user requests with the 'authenticated'
-- or 'anon' role.
-- WARNING: Only meaningful in a SECURITY INVOKER context (e.g. the applications_guard trigger).
-- INSIDE a SECURITY DEFINER function it always returns true; do not use it for permission checks there.
create or replace function private.is_privileged()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('authenticated', 'anon');
$$;

create or replace function private.next_reference_code()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'VB-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.application_reference_seq')::text, 6, '0');
$$;

create or replace function private.write_audit(
  p_actor_id uuid,
  p_action text,
  p_application_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_details jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, application_id, entity_type, entity_id, details)
  values (p_actor_id, p_action, p_application_id, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- auth.users -> profiles
-- ---------------------------------------------------------------------------
-- From the metadata sent by the sign-up form ONLY the first name, last name, date of birth and consent are read.
-- The role is always 'customer'; a staff account cannot be created through user metadata.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_birth date;
begin
  begin
    v_birth := nullif(v_meta ->> 'birth_date', '')::date;
    if v_birth > current_date or v_birth < date '1900-01-01' then
      v_birth := null;
    end if;
  exception when others then
    v_birth := null;
  end;

  insert into public.profiles (id, email, first_name, last_name, birth_date, role, consents_accepted_at)
  values (
    new.id,
    coalesce(new.email, ''),
    left(btrim(coalesce(v_meta ->> 'first_name', '')), 80),
    left(btrim(coalesce(v_meta ->> 'last_name', '')), 80),
    v_birth,
    'customer',
    case when v_meta ->> 'consents_accepted' = 'true' then now() else null end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.handle_user_email_change();

-- Role/active changes are written to the audit log.
create or replace function private.profiles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    perform private.write_audit(
      -- svc_set_staff_access reports the acting staff member via app.actor_id.
      coalesce((select auth.uid()), nullif(current_setting('app.actor_id', true), '')::uuid),
      'staff.access_changed', null, 'profile', new.id::text,
      jsonb_build_object('role_from', old.role, 'role_to', new.role, 'active_from', old.is_active, 'active_to', new.is_active)
    );
  end if;
  return new;
end;
$$;

create trigger profiles_audit
  before update on public.profiles
  for each row execute function private.profiles_audit();

-- ---------------------------------------------------------------------------
-- Application guard
-- ---------------------------------------------------------------------------
create or replace function private.applications_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_privileged boolean := private.is_privileged();
  v_staff boolean := private.is_staff();
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if not v_privileged then
      if new.customer_id is distinct from v_uid then
        raise exception 'Başka bir kullanıcı adına başvuru oluşturulamaz.' using errcode = '42501';
      end if;
      if (select count(*) from public.applications a where a.customer_id = v_uid and a.status = 'draft') >= 5 then
        raise exception 'draft_limit_reached' using errcode = 'P0001',
          hint = 'Aynı anda en fazla 5 taslak başvuru bulunabilir.';
      end if;
      -- Protected fields sent by the client are ignored.
      new.reference_code := null;
      new.status := 'draft';
      new.form_locked := false;
      new.payment_status := 'not_due';
      new.payment_declared_at := null;
      new.payment_reviewed_at := null;
      new.payment_reviewed_by := null;
      new.payment_note := null;
      new.appointment_status := 'not_started';
      new.appointment_at := null;
      new.appointment_location := null;
      new.appointment_note := null;
      new.submitted_at := null;
      new.fees_snapshot_at := null;
      new.created_at := now();
    end if;
    if new.reference_code is null then
      new.reference_code := private.next_reference_code();
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  new.updated_at := now();

  if new.id is distinct from old.id
     or new.customer_id is distinct from old.customer_id
     or new.reference_code is distinct from old.reference_code
     or new.created_at is distinct from old.created_at then
    raise exception 'Başvurunun kimlik alanları değiştirilemez.' using errcode = '42501';
  end if;

  if not v_privileged and not v_staff then
    -- Customer: only in a draft and only the type / sponsor / city fields.
    if old.status <> 'draft' then
      raise exception 'application_not_editable' using errcode = '42501',
        hint = 'Gönderilmiş başvuru müşteri tarafından değiştirilemez.';
    end if;
    if new.status is distinct from old.status
       or new.form_locked is distinct from old.form_locked
       or new.payment_status is distinct from old.payment_status
       or new.payment_declared_at is distinct from old.payment_declared_at
       or new.payment_reviewed_at is distinct from old.payment_reviewed_at
       or new.payment_reviewed_by is distinct from old.payment_reviewed_by
       or new.payment_note is distinct from old.payment_note
       or new.appointment_status is distinct from old.appointment_status
       or new.appointment_at is distinct from old.appointment_at
       or new.appointment_location is distinct from old.appointment_location
       or new.appointment_note is distinct from old.appointment_note
       or new.submitted_at is distinct from old.submitted_at
       or new.fees_snapshot_at is distinct from old.fees_snapshot_at then
      raise exception 'protected_column' using errcode = '42501',
        hint = 'Durum, ödeme ve randevu alanları müşteri tarafından değiştirilemez.';
    end if;
  end if;

  if v_staff and not v_privileged then
    if new.status = 'draft' and old.status <> 'draft' then
      raise exception 'Gönderilmiş başvuru taslağa döndürülemez.' using errcode = 'P0001';
    end if;
    -- The staff member who decided on the payment and the time are stamped on the server.
    if new.payment_status is distinct from old.payment_status and new.payment_status in ('verified', 'rejected') then
      new.payment_reviewed_at := now();
      new.payment_reviewed_by := v_uid;
    end if;
  end if;

  -- Review and later stages cannot be reached without a verified payment (applies to everyone).
  if (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status)
     and new.status in ('in_review', 'documents_complete', 'visa_submitted', 'awaiting_result', 'result_communicated')
     and new.payment_status <> 'verified' then
    raise exception 'payment_not_verified' using errcode = 'P0001',
      hint = 'Ödeme doğrulanmadan başvuru inceleme aşamasına alınamaz.';
  end if;

  return new;
end;
$$;

create trigger applications_guard
  before insert or update on public.applications
  for each row execute function private.applications_guard();

-- Status changes made with a session (staff/customer) are written to the audit log automatically.
-- The service role and svc_* functions write their own entries (otherwise there would be duplicate entries).
create or replace function private.applications_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    return new;
  end if;
  if new.status is distinct from old.status then
    perform private.write_audit(v_actor, 'application.status_changed', new.id, 'application', new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.payment_status is distinct from old.payment_status then
    perform private.write_audit(v_actor, 'payment.status_changed', new.id, 'application', new.id::text,
      jsonb_build_object('from', old.payment_status, 'to', new.payment_status));
  end if;
  if new.appointment_status is distinct from old.appointment_status
     or new.appointment_at is distinct from old.appointment_at then
    perform private.write_audit(v_actor, 'appointment.updated', new.id, 'application', new.id::text,
      jsonb_build_object('status_from', old.appointment_status, 'status_to', new.appointment_status,
        'date_changed', new.appointment_at is distinct from old.appointment_at));
  end if;
  if new.form_locked is distinct from old.form_locked then
    perform private.write_audit(v_actor, 'form.lock_changed', new.id, 'application', new.id::text,
      jsonb_build_object('locked', new.form_locked));
  end if;
  return new;
end;
$$;

create trigger applications_audit
  after update on public.applications
  for each row execute function private.applications_audit();

-- ---------------------------------------------------------------------------
-- Document review
-- ---------------------------------------------------------------------------
create or replace function private.application_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.application_id is distinct from old.application_id then
    raise exception 'Belge başka bir başvuruya taşınamaz.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.review_status is distinct from old.review_status then
    if v_actor is not null then
      new.reviewed_by := v_actor;
      new.reviewed_at := now();
      perform private.write_audit(v_actor, 'document.review_changed', new.application_id, 'application_document', new.id::text,
        jsonb_build_object('from', old.review_status, 'to', new.review_status));
    end if;
    -- The customer can re-upload a document marked missing/correction needed.
    if new.review_status in ('needs_correction', 'missing') then
      new.reupload_allowed := true;
    elsif new.review_status = 'approved' then
      new.reupload_allowed := false;
    end if;
  end if;
  return new;
end;
$$;

create trigger application_documents_guard
  before insert or update on public.application_documents
  for each row execute function private.application_documents_guard();

-- When a file is verified and becomes 'ready': audit entry + (for a document awaiting correction) back to review.
create or replace function private.application_files_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ready' and (tg_op = 'INSERT' or old.status is distinct from 'ready') then
    perform private.write_audit(new.uploaded_by, 'file.uploaded', new.application_id, 'application_file', new.id::text,
      jsonb_build_object('kind', new.kind, 'mime_type', new.mime_type, 'size_bytes', new.size_bytes));
    if new.kind = 'document' then
      update public.application_documents d
        set review_status = 'pending', review_note = null, not_applicable = false,
            not_applicable_reason = null, not_applicable_at = null
        where d.id = new.application_document_id
          and (d.review_status in ('needs_correction', 'missing') or d.not_applicable);
    end if;
  end if;
  return new;
end;
$$;

create trigger application_files_ready
  after insert or update of status on public.application_files
  for each row execute function private.application_files_ready();

-- Configuration changes (price, document rule, folder mapping, setting) are written to the audit log.
create or replace function private.config_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  perform private.write_audit(
    (select auth.uid()),
    'config.' || lower(tg_op),
    null,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'key'),
    '{}'::jsonb
  );
  return coalesce(new, old);
end;
$$;

create trigger settings_audit after insert or update or delete on public.settings
  for each row execute function private.config_audit();
create trigger zip_categories_audit after insert or update or delete on public.zip_categories
  for each row execute function private.config_audit();
create trigger document_types_audit after insert or update or delete on public.document_types
  for each row execute function private.config_audit();
create trigger cities_audit after insert or update or delete on public.cities
  for each row execute function private.config_audit();
create trigger fee_items_audit after insert or update or delete on public.fee_items
  for each row execute function private.config_audit();

create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();
create trigger zip_categories_touch before update on public.zip_categories
  for each row execute function private.touch_updated_at();
create trigger document_types_touch before update on public.document_types
  for each row execute function private.touch_updated_at();
create trigger cities_touch before update on public.cities
  for each row execute function private.touch_updated_at();
create trigger fee_items_touch before update on public.fee_items
  for each row execute function private.touch_updated_at();
create trigger application_form_sections_touch before insert or update on public.application_form_sections
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- API functions
-- ---------------------------------------------------------------------------

-- Creates/updates the document slots required for the application's type.
-- A customer can call it only for their own DRAFT application; staff for any application.
create or replace function public.sync_application_documents(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_uid uuid := (select auth.uid());
begin
  select * into v_app from public.applications where id = p_application_id;
  -- CAUTION: Because this function is SECURITY DEFINER, current_user inside it is the function owner;
  -- private.is_privileged() ALWAYS returns true here and CANNOT be used for permission checks.
  -- Identity is determined with auth.uid(). EXECUTE is only granted to authenticated (which always carries a uid)
  -- and service_role, so an empty uid means the request came from the service role.
  if v_uid is not null
     and not (private.is_staff() or (found and v_app.customer_id = v_uid and v_app.status = 'draft')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.application_documents (application_id, document_type_id, requirement, allow_not_applicable, max_files)
  select v_app.id, dt.id, dt.requirement, dt.allow_not_applicable, dt.max_files
  from public.document_types dt
  where dt.is_active
    and (dt.application_type is null or dt.application_type = any (v_app.application_types))
    and (dt.sponsor_status is null or dt.sponsor_status = v_app.sponsor_status)
  on conflict (application_id, document_type_id) do update
    set requirement = excluded.requirement,
        allow_not_applicable = excluded.allow_not_applicable,
        max_files = excluded.max_files,
        out_of_scope = false,
        -- A document that is now required cannot stay "not applicable".
        not_applicable = case when excluded.requirement = 'required' or not excluded.allow_not_applicable
                              then false else public.application_documents.not_applicable end;

  -- Slots no longer required: deleted if there is no file; if there is a file they are flagged so it is not lost.
  delete from public.application_documents d
  where d.application_id = v_app.id
    and d.document_type_id is not null
    and not exists (select 1 from public.application_files f where f.application_document_id = d.id)
    and not exists (
      select 1 from public.document_types dt
      where dt.id = d.document_type_id and dt.is_active
        and (dt.application_type is null or dt.application_type = any (v_app.application_types))
        and (dt.sponsor_status is null or dt.sponsor_status = v_app.sponsor_status)
    );

  update public.application_documents d
    set out_of_scope = true, requirement = 'optional', not_applicable = false
  where d.application_id = v_app.id
    and d.document_type_id is not null
    and not exists (
      select 1 from public.document_types dt
      where dt.id = d.document_type_id and dt.is_active
        and (dt.application_type is null or dt.application_type = any (v_app.application_types))
        and (dt.sponsor_status is null or dt.sponsor_status = v_app.sponsor_status)
    );
end;
$$;

-- Records staff actions on the server that involve no table change (e.g. ZIP download).
create or replace function public.record_staff_event(
  p_action text,
  p_application_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_action !~ '^(export|form_pdf|file)\.[a-z_]{1,40}$' then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  perform private.write_audit((select auth.uid()), p_action, p_application_id, 'application', p_application_id::text, p_details);
end;
$$;

-- ---- svc_*: ONLY the service role can call these. The server calls them after verifying the user's identity
-- ---- and the business rules; p_actor_id is the user performing the action.

create or replace function public.svc_submit_application(
  p_actor_id uuid,
  p_application_id uuid,
  p_fee_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_app.status <> 'draft' then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_fee_items) <> 'array' or jsonb_array_length(p_fee_items) = 0 then
    raise exception 'fees_missing' using errcode = 'P0001';
  end if;
  if (select count(*) from public.appointment_preferences where application_id = p_application_id) <> 3 then
    raise exception 'appointment_preferences_missing' using errcode = 'P0001';
  end if;

  delete from public.application_fee_items where application_id = p_application_id;
  insert into public.application_fee_items (application_id, label, kind, amount, currency, sort_order)
  select p_application_id, item ->> 'label', item ->> 'kind', (item ->> 'amount')::numeric, item ->> 'currency', ordinality::int
  from jsonb_array_elements(p_fee_items) with ordinality as t (item, ordinality);

  update public.applications
    set status = 'submitted',
        form_locked = true,
        payment_status = 'awaiting_payment',
        appointment_status = 'preferences_submitted',
        submitted_at = now(),
        fees_snapshot_at = now()
    where id = p_application_id;

  perform private.write_audit(p_actor_id, 'application.submitted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('fee_item_count', jsonb_array_length(p_fee_items)));
end;
$$;

create or replace function public.svc_declare_payment(p_actor_id uuid, p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_app.payment_status not in ('awaiting_payment', 'rejected') then
    raise exception 'payment_not_expected' using errcode = 'P0001';
  end if;
  -- The customer's declaration does NOT VERIFY the payment; it only puts it in the staff's check queue.
  update public.applications
    set payment_status = 'under_review', payment_declared_at = now(), payment_note = null
    where id = p_application_id;
  perform private.write_audit(p_actor_id, 'payment.declared_by_customer', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('from', v_app.payment_status));
end;
$$;

create or replace function public.svc_set_appointment_preferences(
  p_actor_id uuid,
  p_application_id uuid,
  p_preferences jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (v_app.status = 'draft' or v_app.appointment_status = 'preferences_requested') then
    raise exception 'preferences_not_editable' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_preferences) <> 'array' or jsonb_array_length(p_preferences) <> 3 then
    raise exception 'three_preferences_required' using errcode = 'P0001';
  end if;

  delete from public.appointment_preferences where application_id = p_application_id;
  -- If the same date+slot is given twice, the UNIQUE constraint rolls the operation back.
  insert into public.appointment_preferences (application_id, rank, preferred_date, slot)
  select p_application_id, ordinality::smallint, (item ->> 'date')::date, item ->> 'slot'
  from jsonb_array_elements(p_preferences) with ordinality as t (item, ordinality);

  if v_app.appointment_status = 'preferences_requested' then
    update public.applications set appointment_status = 'preferences_submitted' where id = p_application_id;
  end if;
  perform private.write_audit(p_actor_id, 'appointment.preferences_saved', p_application_id, 'application', p_application_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.svc_set_document_not_applicable(
  p_actor_id uuid,
  p_document_id uuid,
  p_not_applicable boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.application_documents%rowtype;
  v_app public.applications%rowtype;
begin
  select * into v_doc from public.application_documents where id = p_document_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into v_app from public.applications where id = v_doc.application_id;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (v_app.status = 'draft' or v_doc.reupload_allowed) then
    raise exception 'document_not_editable' using errcode = 'P0001';
  end if;
  if p_not_applicable and (v_doc.requirement = 'required' or not v_doc.allow_not_applicable) then
    raise exception 'not_applicable_not_allowed' using errcode = 'P0001';
  end if;
  if p_not_applicable and exists (
    select 1 from public.application_files f where f.application_document_id = p_document_id and f.status = 'ready'
  ) then
    raise exception 'document_has_files' using errcode = 'P0001';
  end if;

  update public.application_documents
    set not_applicable = p_not_applicable,
        not_applicable_reason = case when p_not_applicable then nullif(left(btrim(coalesce(p_reason, '')), 500), '') else null end,
        not_applicable_at = case when p_not_applicable then now() else null end,
        review_status = case when review_status in ('needs_correction', 'missing') then 'pending' else review_status end
    where id = p_document_id;

  perform private.write_audit(p_actor_id, 'document.not_applicable_changed', v_doc.application_id, 'application_document',
    p_document_id::text, jsonb_build_object('not_applicable', p_not_applicable));
end;
$$;

-- Deletes the file record and returns the storage path to delete (the server deletes the object).
create or replace function public.svc_delete_file(p_actor_id uuid, p_file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.application_files%rowtype;
begin
  select * into v_file from public.application_files where id = p_file_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  delete from public.application_files where id = p_file_id;
  if v_file.status = 'ready' then
    perform private.write_audit(p_actor_id, 'file.deleted', v_file.application_id, 'application_file', p_file_id::text,
      jsonb_build_object('kind', v_file.kind));
  end if;
  return v_file.storage_path;
end;
$$;

create or replace function public.svc_complete_task(p_actor_id uuid, p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.customer_tasks%rowtype;
begin
  select * into v_task from public.customer_tasks where id = p_task_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.applications a where a.id = v_task.application_id and a.customer_id = p_actor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_task.status <> 'open' then
    raise exception 'task_not_open' using errcode = 'P0001';
  end if;
  update public.customer_tasks set status = 'completed', completed_at = now(), completed_by = p_actor_id where id = p_task_id;
  perform private.write_audit(p_actor_id, 'task.completed_by_customer', v_task.application_id, 'customer_task', p_task_id::text, '{}'::jsonb);
end;
$$;

-- Grants/revokes staff rights. A staff member cannot remove their own rights (prevents lock-out).
create or replace function public.svc_set_staff_access(
  p_actor_id uuid,
  p_user_id uuid,
  p_role text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_role not in ('customer', 'staff') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_actor_id is not null and p_actor_id = p_user_id and (p_role <> 'staff' or not p_is_active) then
    raise exception 'cannot_change_own_access' using errcode = 'P0001';
  end if;
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  update public.profiles set role = p_role, is_active = p_is_active where id = p_user_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff list view (RLS is applied with the caller's permissions)
-- ---------------------------------------------------------------------------
create view public.application_overview
with (security_invoker = true)
as
select
  a.id,
  a.reference_code,
  a.customer_id,
  a.application_types,
  a.sponsor_status,
  a.status,
  a.payment_status,
  a.appointment_status,
  a.appointment_at,
  a.submitted_at,
  a.created_at,
  a.updated_at,
  p.first_name as customer_first_name,
  p.last_name as customer_last_name,
  p.email as customer_email,
  coalesce(nullif(s.data ->> 'firstName', ''), p.first_name) as applicant_first_name,
  coalesce(nullif(s.data ->> 'lastName', ''), p.last_name) as applicant_last_name,
  -- For searching: first name, last name, e-mail and application number in one field (ID/passport number NOT INCLUDED).
  lower(concat_ws(' ', a.reference_code, p.first_name, p.last_name, p.email, s.data ->> 'firstName', s.data ->> 'lastName')) as search_text
from public.applications a
join public.profiles p on p.id = a.customer_id
left join public.application_form_sections s on s.application_id = a.id and s.section_id = 'personal';

-- ---------------------------------------------------------------------------
-- Grants: nothing is open by default.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
-- Objects created by later migrations should be closed by default too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- EXECUTE granted to PUBLIC is a global default; it cannot be revoked per schema, so it is revoked globally.
alter default privileges revoke execute on functions from public;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_staff() to authenticated, service_role;
grant execute on function private.is_privileged() to authenticated, service_role;
grant execute on function private.next_reference_code() to authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema private to service_role;

-- Anonymous visitor: public settings only.
grant select on public.settings to anon;

-- Signed-in user: a table-level grant + row-level RLS are both required.
grant select on
  public.profiles, public.settings, public.document_types, public.cities, public.fee_items,
  public.applications, public.application_form_sections, public.application_documents, public.application_files,
  public.appointment_preferences, public.application_fee_items, public.application_messages,
  public.customer_tasks, public.notifications, public.application_overview,
  public.zip_categories, public.staff_notes, public.audit_log
  to authenticated;

grant insert on public.applications to authenticated;
grant update (application_types, sponsor_status, city_id) on public.applications to authenticated;
-- Application fields staff can change (a trigger blocks them separately for customers).
grant update (status, form_locked, payment_status, payment_note, appointment_status, appointment_at,
              appointment_location, appointment_note) on public.applications to authenticated;

grant insert, update on public.application_form_sections to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Tables with staff-only policies
grant insert on public.application_messages, public.staff_notes, public.notifications to authenticated;
grant insert, update, delete on public.customer_tasks to authenticated;
grant insert, delete on public.application_documents to authenticated;
grant update (custom_label, custom_description, requirement, allow_not_applicable, review_status, review_note,
              reupload_allowed, attachment_file_id) on public.application_documents to authenticated;
grant insert, update, delete on public.settings, public.zip_categories, public.document_types, public.cities, public.fee_items
  to authenticated;

grant execute on function public.sync_application_documents(uuid) to authenticated;
grant execute on function public.record_staff_event(text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.zip_categories enable row level security;
alter table public.document_types enable row level security;
alter table public.cities enable row level security;
alter table public.fee_items enable row level security;
alter table public.applications enable row level security;
alter table public.application_form_sections enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_files enable row level security;
alter table public.appointment_preferences enable row level security;
alter table public.application_fee_items enable row level security;
alter table public.application_messages enable row level security;
alter table public.staff_notes enable row level security;
alter table public.customer_tasks enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Does an application belong to the caller? (the applications table's own RLS also applies)
create or replace function private.owns_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.applications a
    where a.id = p_application_id and a.customer_id = (select auth.uid())
  );
$$;
revoke all on function private.owns_application(uuid) from public, anon;
grant execute on function private.owns_application(uuid) to authenticated, service_role;

-- profiles
create policy profiles_select_own_or_staff on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.is_staff());

-- settings
create policy settings_select_public on public.settings
  for select to anon
  using (visibility = 'public');
create policy settings_select_authenticated on public.settings
  for select to authenticated
  using (visibility in ('public', 'customer') or private.is_staff());
create policy settings_staff_insert on public.settings for insert to authenticated with check (private.is_staff());
create policy settings_staff_update on public.settings for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy settings_staff_delete on public.settings for delete to authenticated using (private.is_staff());

-- zip_categories: staff only
create policy zip_categories_staff_select on public.zip_categories for select to authenticated using (private.is_staff());
create policy zip_categories_staff_insert on public.zip_categories for insert to authenticated with check (private.is_staff());
create policy zip_categories_staff_update on public.zip_categories for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy zip_categories_staff_delete on public.zip_categories for delete to authenticated using (private.is_staff());

-- document_types: every signed-in user can read (document names are not secret; documents uploaded earlier for a retired
-- type must still be shown to the customer by name). Only staff manage them.
-- cities, fee_items: everyone (signed in) reads active records, staff manage them.
create policy document_types_select on public.document_types for select to authenticated using (true);
create policy document_types_staff_insert on public.document_types for insert to authenticated with check (private.is_staff());
create policy document_types_staff_update on public.document_types for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy document_types_staff_delete on public.document_types for delete to authenticated using (private.is_staff());

create policy cities_select on public.cities for select to authenticated using (is_active or private.is_staff());
create policy cities_staff_insert on public.cities for insert to authenticated with check (private.is_staff());
create policy cities_staff_update on public.cities for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy cities_staff_delete on public.cities for delete to authenticated using (private.is_staff());

create policy fee_items_select on public.fee_items for select to authenticated using (is_active or private.is_staff());
create policy fee_items_staff_insert on public.fee_items for insert to authenticated with check (private.is_staff());
create policy fee_items_staff_update on public.fee_items for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy fee_items_staff_delete on public.fee_items for delete to authenticated using (private.is_staff());

-- applications
create policy applications_select on public.applications
  for select to authenticated
  using (customer_id = (select auth.uid()) or private.is_staff());
create policy applications_insert_own on public.applications
  for insert to authenticated
  with check (customer_id = (select auth.uid()));
create policy applications_update on public.applications
  for update to authenticated
  using (customer_id = (select auth.uid()) or private.is_staff())
  with check (customer_id = (select auth.uid()) or private.is_staff());

-- application_form_sections
create policy form_sections_select on public.application_form_sections
  for select to authenticated
  using (private.owns_application(application_id) or private.is_staff());
create policy form_sections_insert on public.application_form_sections
  for insert to authenticated
  with check (
    private.is_staff()
    or exists (
      select 1 from public.applications a
      where a.id = application_id and a.customer_id = (select auth.uid()) and not a.form_locked
    )
  );
create policy form_sections_update on public.application_form_sections
  for update to authenticated
  using (
    private.is_staff()
    or exists (
      select 1 from public.applications a
      where a.id = application_id and a.customer_id = (select auth.uid()) and not a.form_locked
    )
  )
  with check (
    private.is_staff()
    or exists (
      select 1 from public.applications a
      where a.id = application_id and a.customer_id = (select auth.uid()) and not a.form_locked
    )
  );

-- application_documents: the customer reads; only staff (and the service role) write
create policy application_documents_select on public.application_documents
  for select to authenticated
  using (private.owns_application(application_id) or private.is_staff());
create policy application_documents_staff_insert on public.application_documents
  for insert to authenticated with check (private.is_staff());
create policy application_documents_staff_update on public.application_documents
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy application_documents_staff_delete on public.application_documents
  for delete to authenticated using (private.is_staff());

-- application_files: read only; inserting/deleting records is done with the service role
create policy application_files_select on public.application_files
  for select to authenticated
  using (private.owns_application(application_id) or private.is_staff());

create policy appointment_preferences_select on public.appointment_preferences
  for select to authenticated
  using (private.owns_application(application_id) or private.is_staff());

create policy application_fee_items_select on public.application_fee_items
  for select to authenticated
  using (private.owns_application(application_id) or private.is_staff());

-- Messages visible to the customer
create policy application_messages_select on public.application_messages
  for select to authenticated
  using (private.owns_application(application_id) or private.is_staff());
create policy application_messages_staff_insert on public.application_messages
  for insert to authenticated
  with check (private.is_staff() and author_id = (select auth.uid()));

-- Internal notes: there is NO policy at all for customers.
create policy staff_notes_staff_select on public.staff_notes
  for select to authenticated using (private.is_staff());
create policy staff_notes_staff_insert on public.staff_notes
  for insert to authenticated
  with check (private.is_staff() and author_id = (select auth.uid()));

create policy customer_tasks_select on public.customer_tasks
  for select to authenticated
  using (private.owns_application(application_id) or private.is_staff());
create policy customer_tasks_staff_insert on public.customer_tasks
  for insert to authenticated with check (private.is_staff() and created_by = (select auth.uid()));
create policy customer_tasks_staff_update on public.customer_tasks
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy customer_tasks_staff_delete on public.customer_tasks
  for delete to authenticated using (private.is_staff());

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_staff_insert on public.notifications
  for insert to authenticated with check (private.is_staff());

-- Audit log: staff read; nobody (with a session) can write, change or delete.
create policy audit_log_staff_select on public.audit_log
  for select to authenticated using (private.is_staff());

-- ---------------------------------------------------------------------------
-- Storage: private bucket + read policy
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-files', 'application-files', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A customer can only read objects in their own application folder ("<application uuid>/...").
-- There is deliberately no INSERT/UPDATE/DELETE policy: uploads go through a single-use signed URL the server
-- generates with the service role; deletion only happens on the server.
create policy "application-files: sahibi veya personel okuyabilir" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'application-files'
    and (
      private.is_staff()
      or exists (
        select 1 from public.applications a
        where a.id::text = (storage.foldername(name))[1]
          and a.customer_id = (select auth.uid())
      )
    )
  );

-- >>> 20261013000300_reference_data.sql
-- =============================================================================
-- Vize Başvuru Portalı — initial configuration
-- =============================================================================
-- This file also runs in PRODUCTION; it only contains information provided by the company.
-- Prices, IBAN, contact details, the city list and the folder mapping are DELIBERATELY empty:
-- the company enters them in the admin panel (Settings).

-- ---------------------------------------------------------------------------
-- ZIP category folders — the names the company uses, with their spelling.
-- ---------------------------------------------------------------------------
insert into public.zip_categories (folder_name, sort_order) values
  ('accomodation', 10),
  ('financial evidence', 20),
  ('life events', 30),
  ('other', 40),
  ('pasaport', 50),
  ('proof of business', 60),
  ('sponsor', 70)
on conflict (folder_name) do nothing;

-- ---------------------------------------------------------------------------
-- Settings (those with a null value are placeholders)
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, visibility) values
  ('company.name', '"Vize Başvuru Portalı"', 'public'),
  ('company.contact_email', 'null', 'public'),
  ('company.contact_phone', 'null', 'public'),
  ('payment.account_holder', 'null', 'customer'),
  ('payment.bank_name', 'null', 'customer'),
  ('payment.iban', 'null', 'customer'),
  ('payment.instructions', 'null', 'customer'),
  -- Receipt upload: off until the company enables it.
  ('payment.receipt_upload_enabled', 'false', 'customer'),
  -- Appointment preference window: how many days from today it starts and how many days it lasts.
  -- Weekend / public holiday rules await the company's approval.
  ('appointment.start_offset_days', '1', 'customer'),
  ('appointment.window_days', '10', 'customer'),
  ('appointment.include_weekends', 'true', 'customer'),
  ('appointment.excluded_dates', '[]', 'customer')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Document types
-- ---------------------------------------------------------------------------
-- The requirement values are INITIAL values derived from the wording in the company's document list:
--   written unconditionally           -> required
--   "varsa / ...ise / ...göre" (if)   -> conditional (the customer can say "not applicable", the consultant sees it)
--   only supporting                   -> optional
-- They can be changed in the admin panel with the company's approval. zip_category_id is deliberately empty.
--
-- Notes:
--  * The "İngiltere bilgi formu" (UK information form) in the shared list is not requested as an upload; the system
--    generates it as a PDF once the form in the portal is filled in.
--  * The person-specific erroneous entry "Oğlunuzun vize fotoğrafı ve pasaportu" was not added to the list.

insert into public.document_types
  (id, label, description, application_type, sponsor_status, requirement, allow_not_applicable, sort_order)
values
  -- Ortak evraklar — shared documents
  ('passport', 'Geçerli pasaport', 'Planlanan gidiş ve dönüş tarihinden itibaren en az altı ay geçerli olmalıdır.', null, null, 'required', false, 10),
  ('old_passports', 'Eski pasaportlar', 'Varsa eski pasaportlarınız.', null, null, 'conditional', true, 20),
  ('previous_visas', 'Eski seyahatlere ait vize fotoğrafları', 'Önceki seyahatlerinize ait vizelerin fotoğrafları.', null, null, 'conditional', true, 30),
  ('residence_certificate', 'Yerleşim yeri belgesi', 'E-Devlet üzerinden alınmış, kare kodlu.', null, null, 'required', false, 40),
  ('population_register', 'Tam vukuatlı nüfus kayıt örneği', 'E-Devlet üzerinden, tüm seçenekler “evet” seçilerek “Nüfus Aile” şeklinde alınmalıdır.', null, null, 'required', false, 50),
  ('id_card', 'Nüfus cüzdanı (ön ve arka yüz)', 'Ön ve arka yüzün fotoğrafı veya fotokopisi.', null, null, 'required', false, 60),
  ('marriage_certificate', 'Evlilik cüzdanı', 'Medeni durumunuza göre.', null, null, 'conditional', true, 70),
  ('bank_statement', 'Banka hesap dökümü', 'Maaş veya birikim hesabınıza ait, son üç aylık, bakiyeli.', null, null, 'required', false, 80),
  ('financial_support_documents', 'Maddi durumu destekleyen belgeler', 'Varsa tapu, araç ruhsatı, kira kontratı vb.', null, null, 'optional', false, 90),
  ('residence_or_work_permit', 'Türkiye ikamet veya çalışma izni', 'Yabancı uyruklu başvuru sahipleri için belgenin fotokopisi.', null, null, 'conditional', true, 100),

  -- Genel (Çalışan) — employed
  ('employee_company_letter', 'Şirket dilekçesi', 'Antetli kâğıtta, ilgili konsolosluğa hitaben, seyahat tarihlerini ve amacını içeren, ıslak imzalı ve kaşeli.', 'general_employee', null, 'required', false, 210),
  ('employee_sgk_statement', 'SGK Tescil ve Hizmet Dökümü', 'E-Devlet''ten alınmış, barkodlu.', 'general_employee', null, 'required', false, 220),
  ('employee_payslips', 'Maaş bordrosu', 'Son üç aylık.', 'general_employee', null, 'required', false, 230),

  -- Self Employed (Kendi İşinin Sahibi)
  ('self_company_letter', 'Şirket dilekçesi', 'Antetli kâğıtta, ilgili konsolosluğa hitaben, seyahat tarihlerini ve amacını içeren, ıslak imzalı ve kaşeli.', 'self_employed', null, 'required', false, 310),
  ('self_tax_certificate', 'Vergi levhası', '', 'self_employed', null, 'required', false, 320),
  ('self_activity_certificate', 'Faaliyet belgesi', '', 'self_employed', null, 'required', false, 330),
  ('self_trade_registry_gazette', 'Ticari Sicil Gazetesi', '', 'self_employed', null, 'required', false, 340),
  ('self_trial_balance', 'Şirket mizanı', 'Şirketin son bir yıllık mizanı.', 'self_employed', null, 'required', false, 350),
  ('self_sgk_statement', 'SGK Tescil ve Hizmet Dökümü', 'E-Devlet''ten alınmış, barkodlu.', 'self_employed', null, 'required', false, 360),
  ('self_company_bank_statement', 'Şirket banka hesap dökümü', 'Son üç aylık, bakiyeli.', 'self_employed', null, 'required', false, 370),
  ('self_personal_account_statements', 'Kişisel hesap dökümleri', 'Son üç aylık kişisel döviz, TL, altın, gümüş, fon veya kripto hesap dökümleri.', 'self_employed', null, 'required', false, 380),
  ('self_large_deposit_explanation', 'Yüksek tutarlı para girişi açıklaması', 'Son üç ayda hesaba yüksek miktarda para girişi olduysa bunu açıklayan fatura veya belgeler.', 'self_employed', null, 'conditional', true, 390),

  -- Emekli — retired
  ('retired_certificate', 'Emeklilik belgesi', 'E-Devlet''ten alınmış.', 'retired', null, 'required', false, 410),
  ('retired_invitation_letter', 'Davet mektubu', 'Ticari seyahat varsa şirket tarafından gönderilen, tarihleri içeren, kaşeli ve imzalı.', 'retired', null, 'conditional', true, 420),

  -- Öğrenci — student
  ('student_certificate', 'Öğrenci belgesi', 'Güncel.', 'student', null, 'required', false, 510),
  ('student_transcript', 'Transkript', 'Güncel.', 'student', null, 'required', false, 520),
  ('student_school_letter', 'Okul yazısı', 'Okuldan alınmış, aktif eğitim gördüğünüzü ve izinli olduğunuzu belirten İngilizce yazı.', 'student', null, 'required', false, 530),

  -- İngiltere Akraba Ziyareti — visiting relatives in the UK (documents requested from the inviting person)
  ('host_passport', 'Davet eden kişinin pasaportu', 'Pasaport fotoğraf sayfasının fotokopisi.', 'uk_family_visit', null, 'required', false, 610),
  ('host_immigration_status', 'Immigration Status ekran görüntüsü', 'Davet eden kişinin British pasaportu yoksa.', 'uk_family_visit', null, 'conditional', true, 620),
  ('host_address_proof', 'Davet eden kişinin adres kanıtı', 'Council Tax Bill veya elektrik, gaz, su faturası.', 'uk_family_visit', null, 'required', false, 630),
  ('host_property_document', 'Kira kontratı veya mülk belgesi', 'Davet eden kişinin kira kontratı veya ev sahibi olduğunu gösteren mülk belgesi.', 'uk_family_visit', null, 'required', false, 640),
  ('host_invitation_letter', 'Resmi davet mektubu', 'Davet eden kişi adına hazırlanmış.', 'uk_family_visit', null, 'required', false, 650),

  -- Sponsored applications — the sponsor's shared documents
  ('sponsor_letter', 'Sponsor dilekçesi', 'Seyahat masraflarınızı karşılayacağını belirten, imzalı.', 'sponsored', null, 'required', false, 710),
  ('sponsor_bank_statement', 'Sponsorun banka hesap dökümü', 'Son üç aylık, bakiyeli. Döküm sponsorun kendi hesabına ait olmalıdır.', 'sponsored', null, 'required', false, 720),
  ('sponsor_financial_documents', 'Sponsorun maddi durumunu destekleyen belgeler', 'Tapu, araç ruhsatı gibi belgeler.', 'sponsored', null, 'conditional', true, 730),
  ('sponsor_relationship_proof', 'Sponsor ile ilişkiyi gösteren belge', 'Sponsor ile aranızdaki ilişkiyi gösteren belge.', 'sponsored', null, 'required', false, 740),
  -- If the sponsor is employed
  ('sponsor_payslips', 'Sponsorun maaş bordrosu', 'Son üç aylık.', 'sponsored', 'employee', 'required', false, 750),
  ('sponsor_sgk_statement', 'Sponsorun SGK Tescil ve Hizmet Dökümü', 'Barkodlu.', 'sponsored', 'employee', 'required', false, 760),
  -- If the sponsor is retired
  ('sponsor_retirement_certificate', 'Sponsorun emeklilik belgesi', 'E-Devlet''ten alınmış.', 'sponsored', 'retired', 'required', false, 770),
  -- If the sponsor owns a business
  ('sponsor_tax_certificate', 'Sponsorun vergi levhası', '', 'sponsored', 'business_owner', 'required', false, 780),
  ('sponsor_activity_certificate', 'Sponsorun faaliyet belgesi', '', 'sponsored', 'business_owner', 'required', false, 790),
  ('sponsor_trade_registry_gazette', 'Sponsorun Ticari Sicil Gazetesi', '', 'sponsored', 'business_owner', 'required', false, 800)
on conflict (id) do nothing;

-- >>> 20261014000100_optional_fees.sql
-- =============================================================================
-- Vize Başvuru Portalı — submission without a fee breakdown
-- =============================================================================
-- since no fixed price is offered to the customer, the portal does not show fee
-- items and submission does not depend on a fee breakdown.
--
-- This file only changes the svc_submit_application function: an empty fee list is now
-- accepted. It changes no table, data or grant; it deletes nothing. Since it is `create or replace`,
-- running it a second time by accident changes nothing. The function's existing execute grants
-- (service_role only) are kept.
--
-- The fee_items and application_fee_items tables and the surcharge columns in the cities table stay in place;
-- they can be reused later with fixed prices. If a fee list is given it is saved as before.

create or replace function public.svc_submit_application(
  p_actor_id uuid,
  p_application_id uuid,
  p_fee_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_fee_count integer;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_app.status <> 'draft' then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;
  if p_fee_items is null or jsonb_typeof(p_fee_items) <> 'array' then
    raise exception 'fees_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.appointment_preferences where application_id = p_application_id) <> 3 then
    raise exception 'appointment_preferences_missing' using errcode = 'P0001';
  end if;

  v_fee_count := jsonb_array_length(p_fee_items);

  delete from public.application_fee_items where application_id = p_application_id;
  insert into public.application_fee_items (application_id, label, kind, amount, currency, sort_order)
  select p_application_id, item ->> 'label', item ->> 'kind', (item ->> 'amount')::numeric, item ->> 'currency', ordinality::int
  from jsonb_array_elements(p_fee_items) with ordinality as t (item, ordinality);

  update public.applications
    set status = 'submitted',
        form_locked = true,
        payment_status = 'awaiting_payment',
        appointment_status = 'preferences_submitted',
        submitted_at = now(),
        fees_snapshot_at = case when v_fee_count > 0 then now() else null end
    where id = p_application_id;

  perform private.write_audit(p_actor_id, 'application.submitted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('fee_item_count', v_fee_count));
end;
$$;

-- >>> 20261014000200_risk_assessments.sql
-- =============================================================================
-- Vize Başvuru Portalı — risk assessment answers
-- =============================================================================
-- The answers to the "Risk Analiz Testi" in the customer panel are stored as a single row per user.
-- The result (eligibility band, warnings) is not stored; the app recomputes it from the answers every time.
--
-- This file adds a new table, its trigger, grants and four RLS policies.
-- It does not change existing tables, data or grants; it deletes nothing. If run a second time the
-- database rejects it with an "already exists" error.
--
-- Access:
--   * A user only reads, writes, updates and deletes THEIR OWN row.
--   * Staff READ all rows (so the consultant can support the customer); they cannot write.
--   * A visitor who is not signed in (anon) can access nothing.

create table public.risk_assessments (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Version of the question set (src/features/risk-test/definition.ts → RISK_TEST_VERSION).
  version integer not null check (version between 1 and 1000),
  -- Index of the selected option per question. The content is validated in the app; here only the shape and size are limited.
  answers jsonb not null check (
    jsonb_typeof(answers) = 'array'
    and jsonb_array_length(answers) between 1 and 64
    and octet_length(answers::text) <= 1000
  ),
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.risk_assessments is 'Risk analiz testi cevapları; kullanıcı başına tek satır.';

-- Earlier files revoked the default privileges; it is still repeated explicitly for this table.
revoke all on public.risk_assessments from anon, authenticated;
alter table public.risk_assessments enable row level security;

create trigger risk_assessments_touch before update on public.risk_assessments
  for each row execute function private.touch_updated_at();

grant all on public.risk_assessments to service_role;
grant select, insert, update, delete on public.risk_assessments to authenticated;

create policy risk_assessments_select on public.risk_assessments
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff());
create policy risk_assessments_insert_own on public.risk_assessments
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy risk_assessments_update_own on public.risk_assessments
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy risk_assessments_delete_own on public.risk_assessments
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- >>> 20261014000300_visa_outcome_random_reference.sql
-- =============================================================================
-- Vize Başvuru Portalı — visa outcome and random reference number
-- =============================================================================
-- Scope:
--   1. Staff send the visa outcome to the customer as "approved" or "refused"; optionally they attach a screenshot
--      of the outcome and write the refusal reason. The customer sees these with "Başvuru sonucunu göster".
--   2. New applications get a random reference number instead of a sequential one (VB-YYYY-NNNNNN).
--      Existing applications keep their number.
--   3. For the step timeline on the customer panel home page the customer can read the status history of their own
--      application (status and time only).
--
-- This file deletes no data. It adds columns to the table, adds "visa_result" to the file type list,
-- and defines the reference number function and the svc_set_visa_outcome and application_status_history functions.
-- If run a second time it stops with an "already exists" error on the first statement and nothing changes
-- (the SQL Editor runs the file as a single transaction).

-- ---------------------------------------------------------------------------
-- 1. Visa outcome
-- ---------------------------------------------------------------------------

alter table public.applications
  add column visa_outcome text check (visa_outcome in ('approved', 'refused')),
  add column visa_outcome_note text check (char_length(visa_outcome_note) <= 2000),
  add column visa_outcome_file_id uuid references public.application_files (id) on delete set null,
  add column visa_outcome_at timestamptz,
  -- The refusal reason cannot be empty for a refusal.
  add constraint applications_visa_outcome_note_required
    check (visa_outcome is distinct from 'refused' or coalesce(btrim(visa_outcome_note), '') <> '');

-- The screenshot of the outcome is stored as a separate file type in the application's private folder.
alter table public.application_files drop constraint application_files_kind_check;
alter table public.application_files add constraint application_files_kind_check
  check (kind in ('document', 'payment_receipt', 'staff_attachment', 'visa_result'));

-- The customer READS the new columns on their own application (table-level SELECT grant and RLS).
-- No session gets an UPDATE grant for these columns: writes only happen through the function below,
-- after the server has verified the staff member's identity.

-- Staff recording the visa outcome. Returns the file id of the replaced old screenshot
-- (null if none); the server deletes that file and its object in storage.
create or replace function public.svc_set_visa_outcome(
  p_actor_id uuid,
  p_application_id uuid,
  p_outcome text,
  p_note text,
  p_file_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_previous uuid;
begin
  -- Session permissions cannot be trusted inside SECURITY DEFINER; that the actor is active staff is checked here.
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('approved', 'refused') then
    raise exception 'visa_outcome_invalid' using errcode = '22023';
  end if;
  if p_outcome = 'refused' and v_note is null then
    raise exception 'visa_outcome_note_required' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'visa_outcome_note_too_long' using errcode = '22023';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.status not in ('visa_submitted', 'awaiting_result', 'result_communicated') then
    raise exception 'visa_outcome_not_allowed' using errcode = 'P0001';
  end if;
  if p_file_id is not null and not exists (
    select 1 from public.application_files f
    where f.id = p_file_id and f.application_id = p_application_id and f.kind = 'visa_result' and f.status = 'ready'
  ) then
    raise exception 'visa_outcome_file_invalid' using errcode = 'P0001';
  end if;

  v_previous := v_app.visa_outcome_file_id;

  -- If the payment is not verified applications_guard rejects this update (payment_not_verified).
  update public.applications
     set visa_outcome = p_outcome,
         visa_outcome_note = v_note,
         visa_outcome_file_id = p_file_id,
         visa_outcome_at = now(),
         status = 'result_communicated'
   where id = p_application_id;

  -- The audit trigger does not write changes made with the service role; the entries are written here.
  if v_app.status <> 'result_communicated' then
    perform private.write_audit(p_actor_id, 'application.status_changed', p_application_id, 'application', p_application_id::text,
      jsonb_build_object('from', v_app.status, 'to', 'result_communicated'));
  end if;
  perform private.write_audit(p_actor_id, 'application.visa_outcome_set', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('outcome', p_outcome, 'with_file', p_file_id is not null));

  return case when v_previous is distinct from p_file_id then v_previous else null end;
end;
$$;

revoke all on function public.svc_set_visa_outcome(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.svc_set_visa_outcome(uuid, uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Random reference number
-- ---------------------------------------------------------------------------

-- The number is picked at random between 100000–999999; it carries no sequence information. If a used number
-- comes up a new one is picked. The format stays the same: VB-YYYY-NNNNNN.
create or replace function private.next_reference_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  loop
    v_code := 'VB-' || to_char(now(), 'YYYY') || '-' || (100000 + floor(random() * 900000))::int::text;
    exit when not exists (select 1 from public.applications a where a.reference_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- `create or replace` keeps the existing grants; they are still written explicitly.
revoke all on function private.next_reference_code() from public, anon;
grant execute on function private.next_reference_code() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Status history of an application (customer panel step timeline)
-- ---------------------------------------------------------------------------

-- The audit log is closed to customers. This function only returns the times the application was submitted and its
-- status changed; who performed the action and other details are not returned.
-- Session permissions cannot be trusted inside SECURITY DEFINER: access is checked here with auth.uid()
-- (the application's owner or active staff). A user without access gets an empty list.
create or replace function public.application_status_history(p_application_id uuid)
returns table (status text, changed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select case when l.action = 'application.submitted' then 'submitted' else l.details ->> 'to' end as status,
         l.created_at as changed_at
  from public.audit_log l
  where l.application_id = p_application_id
    and l.action in ('application.submitted', 'application.status_changed')
    and exists (
      select 1 from public.applications a
      where a.id = p_application_id
        and (
          a.customer_id = (select auth.uid())
          or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'staff' and p.is_active)
        )
    )
  order by l.created_at, l.id;
$$;

revoke all on function public.application_status_history(uuid) from public, anon;
grant execute on function public.application_status_history(uuid) to authenticated, service_role;

-- >>> 20261015000100_document_rules.sql
-- =============================================================================
-- Vize Başvuru Portalı — document rules update
-- =============================================================================
-- Scope:
--   1. The customer only sees the "not applicable to me" option on CONDITIONAL documents.
--   2. A new required document for Self Employed applications: a recent invoice or Z report.
--   3. The "Davet mektubu" (invitation letter) in Retired applications is no longer required (retired, not deleted).
--   4. The company letter, the official invitation letter and the sponsor letter are prepared by the company:
--      they are optional and their descriptions become "Bu belge tarafımızca hazırlanacaktır." (we will prepare this document).
--   5. Parental consent letter for applicants under 18 (optional, prepared by the company).
--      The document is only added to the list of those under 18 according to the date of birth in the form.
--
-- This file deletes no application data. It adds a column and two new types to document types, changes the rule and
-- description of four types and the usage of one type; it redefines the document sync function with
-- the under-18 rule. Document lists of submitted applications do not change; drafts are synced
-- with the new rules the next time they are opened.
-- If run a second time it stops with an "already exists" error on the first statement and nothing changes
-- (the SQL Editor runs the file as a single transaction).

-- ---------------------------------------------------------------------------
-- 1. Documents required only from applicants under 18
-- ---------------------------------------------------------------------------

alter table public.document_types
  add column minors_only boolean not null default false;

-- Whether the applicant is under 18 according to the date of birth in the form (today in Istanbul time).
-- Returns "no" if the date of birth is missing or malformed. The date is compared as text so that
-- an invalid date (e.g. 30 February) does not break the sync with a conversion error.
create function private.applicant_is_minor(p_application_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select (s.data ->> 'birthDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       and (s.data ->> 'birthDate') > to_char(((now() at time zone 'Europe/Istanbul')::date - interval '18 years'), 'YYYY-MM-DD')
    from public.application_form_sections s
    where s.application_id = p_application_id and s.section_id = 'personal'
  ), false);
$$;

-- Only called from inside the document sync function (as its owner); not opened to any session.
revoke all on function private.applicant_is_minor(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. "Not applicable" only on conditional documents
-- ---------------------------------------------------------------------------

update public.document_types set allow_not_applicable = (requirement = 'conditional')
  where allow_not_applicable is distinct from (requirement = 'conditional');

alter table public.document_types
  add constraint document_types_not_applicable_conditional_only
  check (allow_not_applicable = (requirement = 'conditional'));

-- ---------------------------------------------------------------------------
-- 3. Document list changes
-- ---------------------------------------------------------------------------

-- Retired "Davet mektubu": came from the line "ticari seyahat varsa davet mektubu" (invitation letter if business travel)
-- in the company's first document list. It is retired rather than deleted so uploaded files are not lost.
update public.document_types set is_active = false where id = 'retired_invitation_letter';

-- Documents prepared by the company.
update public.document_types
  set requirement = 'optional',
      allow_not_applicable = false,
      description = 'Bu belge tarafımızca hazırlanacaktır.'
  where id in ('employee_company_letter', 'self_company_letter', 'host_invitation_letter', 'sponsor_letter');

insert into public.document_types
  (id, label, description, application_type, sponsor_status, requirement, allow_not_applicable, sort_order, minors_only)
values
  ('self_invoices_or_z_reports', 'Fatura veya Z raporu',
   'Yakın tarihli kesilmiş birkaç adet fatura ya da birkaç günlük Z raporu.',
   'self_employed', null, 'required', false, 395, false),
  ('parental_consent', 'Ebeveyn muvafakatnamesi',
   'Bu belge tarafımızca hazırlanacaktır.',
   null, null, 'optional', false, 105, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Document sync: the under-18 rule
-- ---------------------------------------------------------------------------
-- Same as the definition in 20261013000200_security.sql; only the "minors_only" condition is added.
-- CREATE OR REPLACE keeps the existing EXECUTE grants.

create or replace function public.sync_application_documents(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_uid uuid := (select auth.uid());
  v_minor boolean;
begin
  select * into v_app from public.applications where id = p_application_id;
  -- CAUTION: Because this function is SECURITY DEFINER, current_user inside it is the function owner;
  -- private.is_privileged() ALWAYS returns true here and CANNOT be used for permission checks.
  -- Identity is determined with auth.uid(). EXECUTE is only granted to authenticated (which always carries a uid)
  -- and service_role, so an empty uid means the request came from the service role.
  if v_uid is not null
     and not (private.is_staff() or (found and v_app.customer_id = v_uid and v_app.status = 'draft')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_minor := private.applicant_is_minor(v_app.id);

  insert into public.application_documents (application_id, document_type_id, requirement, allow_not_applicable, max_files)
  select v_app.id, dt.id, dt.requirement, dt.allow_not_applicable, dt.max_files
  from public.document_types dt
  where dt.is_active
    and (dt.application_type is null or dt.application_type = any (v_app.application_types))
    and (dt.sponsor_status is null or dt.sponsor_status = v_app.sponsor_status)
    and (not dt.minors_only or v_minor)
  on conflict (application_id, document_type_id) do update
    set requirement = excluded.requirement,
        allow_not_applicable = excluded.allow_not_applicable,
        max_files = excluded.max_files,
        out_of_scope = false,
        -- A document that is now required cannot stay "not applicable".
        not_applicable = case when excluded.requirement = 'required' or not excluded.allow_not_applicable
                              then false else public.application_documents.not_applicable end;

  -- Slots no longer required: deleted if there is no file; if there is a file they are flagged so it is not lost.
  delete from public.application_documents d
  where d.application_id = v_app.id
    and d.document_type_id is not null
    and not exists (select 1 from public.application_files f where f.application_document_id = d.id)
    and not exists (
      select 1 from public.document_types dt
      where dt.id = d.document_type_id and dt.is_active
        and (dt.application_type is null or dt.application_type = any (v_app.application_types))
        and (dt.sponsor_status is null or dt.sponsor_status = v_app.sponsor_status)
        and (not dt.minors_only or v_minor)
    );

  update public.application_documents d
    set out_of_scope = true, requirement = 'optional', not_applicable = false
  where d.application_id = v_app.id
    and d.document_type_id is not null
    and not exists (
      select 1 from public.document_types dt
      where dt.id = d.document_type_id and dt.is_active
        and (dt.application_type is null or dt.application_type = any (v_app.application_types))
        and (dt.sponsor_status is null or dt.sponsor_status = v_app.sponsor_status)
        and (not dt.minors_only or v_minor)
    );
end;
$$;

-- >>> 20261015000200_customer_profile.sql
-- =============================================================================
-- Vize Başvuru Portalı — customers correcting their own details
-- =============================================================================
-- the customer sees and corrects their personal details on the "Hesabım" (My Account) page.
--
-- A user can change only their first name, last name and date of birth, only on THEIR OWN row.
-- No permission is granted for role, account status or e-mail (the e-mail changes through Supabase Auth).
-- This file deletes or changes no data; it only adds a grant and a row policy.
-- If run a second time it stops with an "already exists" error on the first statement and nothing changes
-- (the SQL Editor runs the file as a single transaction).

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant update (first_name, last_name, birth_date) on public.profiles to authenticated;

-- >>> 20261015000300_notifications_dates_accounts.sql
-- =============================================================================
-- Vize Başvuru Portalı — notification deletion, "dates don't suit me", account deletion, document deletion
-- =============================================================================
-- Scope:
--   1. Appointment: if "Bu tarihlerin hiçbiri bana uymuyor" is chosen, three preferences are no longer required; the customer
--      picks at most three of the following working days (all day / morning / afternoon).
--   2. Account deletion: a customer without a submitted application deletes their account, drafts and documents
--      themselves; with a submitted application a deletion request reaches the company and staff decide.
--   3. Customers can delete their own notifications.
--   4. Document deletion in Settings: in one step, in the database (so it never stops halfway and no files are lost).
--
-- This file adds tables, columns, policies and functions; it redefines the appointment saving and application submission
-- functions. It deletes or changes no data. (Deletions only happen when a user or staff member requests them
-- in the app, through the functions below.)
-- If run a second time it stops with an "already exists" error on the first statement and nothing changes
-- (the SQL Editor runs the file as a single transaction).

-- ---------------------------------------------------------------------------
-- 1. Appointment: "Bu tarihlerin hiçbiri bana uymuyor"
-- ---------------------------------------------------------------------------

-- The customer cannot change this column directly (no column grant); only svc_set_appointment_preferences writes it.
alter table public.applications
  add column appointment_outside_window boolean not null default false;

alter table public.appointment_preferences drop constraint appointment_preferences_slot_check;
alter table public.appointment_preferences add constraint appointment_preferences_slot_check
  check (slot in ('morning', 'evening', 'full_day'));

-- Since a parameter was added the old definition is dropped (so two definitions with the same name do not remain).
drop function public.svc_set_appointment_preferences(uuid, uuid, jsonb);

create function public.svc_set_appointment_preferences(
  p_actor_id uuid,
  p_application_id uuid,
  p_preferences jsonb,
  p_outside_window boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_count integer;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (v_app.status = 'draft' or v_app.appointment_status = 'preferences_requested') then
    raise exception 'preferences_not_editable' using errcode = 'P0001';
  end if;
  if p_outside_window is null or jsonb_typeof(p_preferences) <> 'array' then
    raise exception 'preferences_invalid' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_preferences);
  if p_outside_window then
    -- If the offered dates don't suit: 1–3 of the following working days, each day at most once.
    if v_count < 1 or v_count > 3 then
      raise exception 'one_to_three_preferences_required' using errcode = 'P0001';
    end if;
    if (select count(distinct item ->> 'date') from jsonb_array_elements(p_preferences) as t (item)) <> v_count then
      raise exception 'duplicate_preference_date' using errcode = 'P0001';
    end if;
  else
    if v_count <> 3 then
      raise exception 'three_preferences_required' using errcode = 'P0001';
    end if;
    if exists (select 1 from jsonb_array_elements(p_preferences) as t (item) where item ->> 'slot' = 'full_day') then
      raise exception 'preferences_invalid' using errcode = '22023';
    end if;
  end if;

  delete from public.appointment_preferences where application_id = p_application_id;
  -- If the same date+slot is given twice, the UNIQUE constraint rolls the operation back.
  insert into public.appointment_preferences (application_id, rank, preferred_date, slot)
  select p_application_id, ordinality::smallint, (item ->> 'date')::date, item ->> 'slot'
  from jsonb_array_elements(p_preferences) with ordinality as t (item, ordinality);

  update public.applications
    set appointment_outside_window = p_outside_window,
        appointment_status = case when v_app.appointment_status = 'preferences_requested' then 'preferences_submitted' else appointment_status end
    where id = p_application_id;
  perform private.write_audit(p_actor_id, 'appointment.preferences_saved', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('outside_window', p_outside_window));
end;
$$;

revoke all on function public.svc_set_appointment_preferences(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.svc_set_appointment_preferences(uuid, uuid, jsonb, boolean) to service_role;

-- Submission: if "dates don't suit me" was chosen, 1–3 preferences are enough. The rest is the same as 20261014000100_optional_fees.sql.
create or replace function public.svc_submit_application(
  p_actor_id uuid,
  p_application_id uuid,
  p_fee_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_fee_count integer;
  v_preference_count integer;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_app.status <> 'draft' then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;
  if p_fee_items is null or jsonb_typeof(p_fee_items) <> 'array' then
    raise exception 'fees_invalid' using errcode = '22023';
  end if;
  select count(*) into v_preference_count from public.appointment_preferences where application_id = p_application_id;
  if (v_app.appointment_outside_window and v_preference_count not between 1 and 3)
     or (not v_app.appointment_outside_window and v_preference_count <> 3) then
    raise exception 'appointment_preferences_missing' using errcode = 'P0001';
  end if;

  v_fee_count := jsonb_array_length(p_fee_items);

  delete from public.application_fee_items where application_id = p_application_id;
  insert into public.application_fee_items (application_id, label, kind, amount, currency, sort_order)
  select p_application_id, item ->> 'label', item ->> 'kind', (item ->> 'amount')::numeric, item ->> 'currency', ordinality::int
  from jsonb_array_elements(p_fee_items) with ordinality as t (item, ordinality);

  update public.applications
    set status = 'submitted',
        form_locked = true,
        payment_status = 'awaiting_payment',
        appointment_status = 'preferences_submitted',
        submitted_at = now(),
        fees_snapshot_at = case when v_fee_count > 0 then now() else null end
    where id = p_application_id;

  perform private.write_audit(p_actor_id, 'application.submitted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('fee_item_count', v_fee_count));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Notification deletion
-- ---------------------------------------------------------------------------

create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant delete on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Account deletion
-- ---------------------------------------------------------------------------

-- Deletion request of a customer with a submitted application. Staff either refuse the request (with a note)
-- or delete the account; when the account is deleted the request is deleted too and the record stays in the audit log.
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'rejected')),
  -- Refusal reason; shown to the customer.
  staff_note text check (char_length(staff_note) <= 1000),
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  check (status = 'pending' or (staff_note is not null and btrim(staff_note) <> ''))
);
-- A user can have only one pending request at a time.
create unique index account_deletion_requests_pending_idx on public.account_deletion_requests (user_id) where status = 'pending';

alter table public.account_deletion_requests enable row level security;

-- Default privileges are not trusted: everything is revoked first, then only what is needed is granted.
revoke all on public.account_deletion_requests from anon, authenticated;
grant all on public.account_deletion_requests to service_role;
grant select on public.account_deletion_requests to authenticated;
-- A customer can only open a request with their own identity; the status and staff fields keep their defaults.
grant insert (user_id) on public.account_deletion_requests to authenticated;
grant update (status, staff_note, handled_by, handled_at) on public.account_deletion_requests to authenticated;

create policy account_deletion_requests_select on public.account_deletion_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff());
create policy account_deletion_requests_insert_own on public.account_deletion_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()) and not private.is_staff());
create policy account_deletion_requests_staff_update on public.account_deletion_requests
  for update to authenticated
  using (private.is_staff())
  with check (private.is_staff() and (handled_by is null or handled_by = (select auth.uid())));

-- Deletes the account's application data and returns the storage paths of the deleted files. The server calls it after
-- verifying the user's or staff member's identity; then it deletes the files in storage and the Auth user
-- (the profile, notifications, risk test and request record are deleted with the user).
--   * The customer themselves: refused if they have a submitted (non-draft) application.
--   * Active staff: only if there is a pending deletion request.
create function public.svc_delete_account_data(p_actor_id uuid, p_user_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_by_staff boolean;
  v_count integer;
begin
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_target.role <> 'customer' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Applications are locked: no application can be submitted between the check and the deletion.
  perform 1 from public.applications a where a.customer_id = p_user_id for update;

  if p_actor_id = p_user_id then
    v_by_staff := false;
    if exists (select 1 from public.applications a where a.customer_id = p_user_id and a.status <> 'draft') then
      raise exception 'has_submitted_applications' using errcode = 'P0001';
    end if;
  elsif exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active) then
    v_by_staff := true;
    if not exists (select 1 from public.account_deletion_requests r where r.user_id = p_user_id and r.status = 'pending') then
      raise exception 'no_pending_request' using errcode = 'P0001';
    end if;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_count from public.applications a where a.customer_id = p_user_id;

  return query
    select f.storage_path
    from public.application_files f
    join public.applications a on a.id = f.application_id
    where a.customer_id = p_user_id;

  -- Form answers, document slots, file records, messages, notes and tasks are deleted together with the application.
  delete from public.applications where customer_id = p_user_id;

  -- No ID or name is written; only who deleted and how many applications were deleted.
  perform private.write_audit(case when v_by_staff then p_actor_id end, 'account.deleted', null, 'profile', p_user_id::text,
    jsonb_build_object('by', case when v_by_staff then 'staff' else 'customer' end, 'application_count', v_count));
end;
$$;

revoke all on function public.svc_delete_account_data(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_delete_account_data(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Document deletion in Settings
-- ---------------------------------------------------------------------------
-- The document is retired and its empty slots in drafts are removed. If no slot remains in a submitted application or in a
-- draft with uploaded files, the document is deleted ('deleted'); otherwise it stays retired ('deactivated').
create function public.delete_document_type(p_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Inside SECURITY DEFINER identity is checked with auth.uid() (private.is_staff uses it).
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- The row is locked: a concurrent document sync cannot add new slots meanwhile.
  perform 1 from public.document_types where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.document_types set is_active = false where id = p_id and is_active;

  delete from public.application_documents d
    using public.applications a
    where d.document_type_id = p_id
      and a.id = d.application_id
      and a.status = 'draft'
      and not exists (select 1 from public.application_files f where f.application_document_id = d.id);

  if exists (select 1 from public.application_documents d where d.document_type_id = p_id) then
    return 'deactivated';
  end if;
  delete from public.document_types where id = p_id;
  return 'deleted';
end;
$$;

revoke all on function public.delete_document_type(text) from public, anon;
grant execute on function public.delete_document_type(text) to authenticated, service_role;

-- >>> 20261015000400_appointment_calendar.sql
-- =============================================================================
-- Vize Başvuru Portalı — appointment preferences from a calendar
-- =============================================================================
-- appointment preferences are always picked from a calendar. The customer picks each day
-- once and says "Tam gün" (all day), "Öğleden önce" (morning) or "Öğleden sonra" (afternoon).
--   * Normal preference: three different days ("Tam gün" is now accepted here too).
--   * "Bu tarihlerin hiçbiri bana uymuyor": 1–3 different days (unchanged).
--
-- This file only redefines the svc_set_appointment_preferences function. It changes no table, data or grant;
-- it deletes nothing. Previously saved preferences stay as they are (old records with two time slots on the same day
-- remain valid; the new rule only applies when saving again). Since it is `create or replace`,
-- running it a second time by accident changes nothing; the existing execute grants (service_role only) are kept.

create or replace function public.svc_set_appointment_preferences(
  p_actor_id uuid,
  p_application_id uuid,
  p_preferences jsonb,
  p_outside_window boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_count integer;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (v_app.status = 'draft' or v_app.appointment_status = 'preferences_requested') then
    raise exception 'preferences_not_editable' using errcode = 'P0001';
  end if;
  if p_outside_window is null or jsonb_typeof(p_preferences) <> 'array' then
    raise exception 'preferences_invalid' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_preferences);
  if p_outside_window then
    -- If the offered dates don't suit: 1–3 days from later working days.
    if v_count < 1 or v_count > 3 then
      raise exception 'one_to_three_preferences_required' using errcode = 'P0001';
    end if;
  elsif v_count <> 3 then
    raise exception 'three_preferences_required' using errcode = 'P0001';
  end if;
  -- Each day is picked once in the calendar.
  if (select count(distinct item ->> 'date') from jsonb_array_elements(p_preferences) as t (item)) <> v_count then
    raise exception 'duplicate_preference_date' using errcode = 'P0001';
  end if;

  delete from public.appointment_preferences where application_id = p_application_id;
  insert into public.appointment_preferences (application_id, rank, preferred_date, slot)
  select p_application_id, ordinality::smallint, (item ->> 'date')::date, item ->> 'slot'
  from jsonb_array_elements(p_preferences) with ordinality as t (item, ordinality);

  update public.applications
    set appointment_outside_window = p_outside_window,
        appointment_status = case when v_app.appointment_status = 'preferences_requested' then 'preferences_submitted' else appointment_status end
    where id = p_application_id;
  perform private.write_audit(p_actor_id, 'appointment.preferences_saved', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('outside_window', p_outside_window));
end;
$$;

-- >>> 20261016000100_message_reads.sql
-- =============================================================================
-- Migration 11: "read" state of consultant messages
-- =============================================================================
-- Unread messages are marked on the application status page ("1 yeni"); a message is marked read when the customer clicks it.
-- The customer has NO write grant on the message table: the read time is only written through the function below, only for
-- a message in their own application and only once. The message's text, author and date never change.

alter table public.application_messages add column if not exists customer_read_at timestamptz;

create or replace function public.mark_message_read(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  -- Inside SECURITY DEFINER permission is checked with auth.uid() (private.is_privileged() always returns true here).
  select exists (
    select 1
    from public.application_messages m
    join public.applications a on a.id = m.application_id
    where m.id = p_message_id and a.customer_id = (select auth.uid())
  ) into v_found;
  if not v_found then
    return false;
  end if;
  update public.application_messages
    set customer_read_at = now()
    where id = p_message_id and customer_read_at is null;
  return true;
end;
$$;

revoke all on function public.mark_message_read(uuid) from public, anon;
grant execute on function public.mark_message_read(uuid) to authenticated;

-- >>> 20261016000200_automatic_status.sql
-- =============================================================================
-- Migration 12: automatic status transitions, a simpler appointment flow, appointment locations
-- =============================================================================
-- Decisions:
--   * The status dropdown in the admin panel goes away; the application status follows from what the consultant and
--     the customer do (review once the payment is verified, "Müşteriden işlem bekleniyor" while something is expected from
--     the customer, back to review once it is done).
--   * "Evraklar tamamlandı" is marked with the consultant's button (a human makes the final call).
--   * Once the appointment date has passed the appointment becomes "Randevu gerçekleşti" by itself and the application
--     moves to "Sonuç bekleniyor" (scheduled job: supabase/cron/complete-past-appointments.sql).
--   * "Vize başvurusu yapıldı" and "Sonuç bekleniyor" become a single stage ("Sonuç bekleniyor"); "Evrak eksik veya düzeltme
--     gerekli" and "Müşteriden belge veya imza bekleniyor" become a single stage ("Müşteriden işlem bekleniyor");
--     the appointment's "Randevu ayarlanıyor" goes away.
--   * The appointment location is not typed by hand; it is picked from the "Randevu yerleri" list in Settings (name + address).
--
-- DATA: no row is deleted. Old status values are moved to the new ones (section 1 below; the appointment of applications in
-- "Vize başvurusu yapıldı" and "Sonuç bekleniyor" counts as "Randevu gerçekleşti") and the status of every submitted
-- application is recomputed once with the new rule (last section). Old values in the audit log
-- stay as they are.
-- If run a second time it stops with an "already exists" error while creating the "appointment locations" table and
-- nothing changes (the SQL Editor runs the file as a single transaction).

-- ---------------------------------------------------------------------------
-- 1. Status values
-- ---------------------------------------------------------------------------

create table public.appointment_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 120),
  address text not null check (char_length(btrim(address)) between 1 and 400),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.applications drop constraint applications_status_check;
alter table public.applications drop constraint applications_appointment_status_check;

-- An application whose payment is not verified cannot be "Müşteriden işlem bekleniyor" (new rule); those return to "Başvuru gönderildi".
update public.applications
   set status = case when payment_status = 'verified' then 'awaiting_customer' else 'submitted' end
 where status = 'correction_required';
-- The appointment of an application whose visa application was made or whose result is awaited has taken place; in the new rule the
-- "Sonuç bekleniyor" stage goes together with "Randevu gerçekleşti" (otherwise the recomputation below would move them back).
update public.applications
   set status = 'awaiting_result', appointment_status = 'completed'
 where status in ('visa_submitted', 'awaiting_result');
update public.applications set appointment_status = 'preferences_submitted' where appointment_status = 'booking_in_progress';

alter table public.applications add constraint applications_status_check check (
  status in (
    'draft', 'submitted', 'in_review', 'awaiting_customer', 'documents_complete', 'awaiting_result',
    'result_communicated', 'cancelled'
  )
);
alter table public.applications add constraint applications_appointment_status_check check (
  appointment_status in ('not_started', 'preferences_submitted', 'preferences_requested', 'scheduled', 'completed')
);

-- ---------------------------------------------------------------------------
-- 2. Appointment locations (Settings). Only staff see and manage them; the customer reads the location of their appointment
--    from the copy in their application (name and address). So the information sent to the customer is kept even if the location later changes or is deleted.
-- ---------------------------------------------------------------------------

alter table public.appointment_locations enable row level security;

-- Default privileges are not trusted: everything is revoked first, then only what is needed is granted.
revoke all on public.appointment_locations from anon, authenticated;
grant all on public.appointment_locations to service_role;
grant select, insert, update, delete on public.appointment_locations to authenticated;

create policy appointment_locations_staff_select on public.appointment_locations
  for select to authenticated using (private.is_staff());
create policy appointment_locations_staff_insert on public.appointment_locations
  for insert to authenticated with check (private.is_staff());
create policy appointment_locations_staff_update on public.appointment_locations
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy appointment_locations_staff_delete on public.appointment_locations
  for delete to authenticated using (private.is_staff());

create trigger appointment_locations_audit after insert or update or delete on public.appointment_locations
  for each row execute function private.config_audit();
create trigger appointment_locations_touch before update on public.appointment_locations
  for each row execute function private.touch_updated_at();

alter table public.applications
  add column appointment_location_id uuid references public.appointment_locations (id) on delete set null,
  add column appointment_address text check (char_length(appointment_address) <= 400);

-- Staff write the appointment location to the application (a trigger blocks it separately for customers).
grant update (appointment_location_id, appointment_address) on public.applications to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Automatic status rule
-- ---------------------------------------------------------------------------

-- Is something expected from the customer? (TypeScript counterpart: src/features/applications/status-flow.ts)
--   * the form of a submitted application is open for correction,
--   * an open task,
--   * a problem reported on a document ("correction needed" / "missing") or a re-upload requested but no file
--     (src/features/documents/rules.ts → needsCustomerAction).
create or replace function private.customer_action_outstanding(p_application_id uuid, p_form_locked boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.applications a where a.id = p_application_id and a.status <> 'draft' and not p_form_locked)
    or exists (select 1 from public.customer_tasks t where t.application_id = p_application_id and t.status = 'open')
    or exists (
      select 1 from public.application_documents d
      where d.application_id = p_application_id
        and not d.out_of_scope
        and (
          d.review_status in ('needs_correction', 'missing')
          or (
            d.reupload_allowed and not d.not_applicable and d.requirement <> 'optional'
            and not exists (
              select 1 from public.application_files f
              where f.application_document_id = d.id and f.kind = 'document' and f.status = 'ready'
            )
          )
        )
    );
$$;

-- The status the application should have. Draft, cancelled and result sent change by hand/action; the others follow from here.
-- The consultant's "Evraklar tamamlandı" mark is kept until something new is expected from the customer.
create or replace function private.next_application_status(
  p_status text,
  p_payment_status text,
  p_appointment_status text,
  p_outstanding boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status in ('draft', 'cancelled', 'result_communicated') then p_status
    when p_payment_status is distinct from 'verified' then 'submitted'
    when p_appointment_status = 'completed' then 'awaiting_result'
    when p_outstanding then 'awaiting_customer'
    when p_status in ('documents_complete', 'awaiting_result') then 'documents_complete'
    else 'in_review'
  end;
$$;

-- Updates the application's status according to the rule. applications_audit writes the audit entry for changes made with a session;
-- changes without a session (server actions, scheduled job) are written here as "Sistem".
create or replace function private.sync_application_status(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_next text;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    return;
  end if;
  v_next := private.next_application_status(
    v_app.status, v_app.payment_status, v_app.appointment_status,
    private.customer_action_outstanding(p_application_id, v_app.form_locked)
  );
  if v_next is distinct from v_app.status then
    update public.applications set status = v_next where id = p_application_id;
    if (select auth.uid()) is null then
      perform private.write_audit(null, 'application.status_changed', p_application_id, 'application', p_application_id::text,
        jsonb_build_object('from', v_app.status, 'to', v_next, 'automatic', true));
    end if;
  end if;
end;
$$;

create or replace function private.status_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'applications' then
    perform private.sync_application_status(new.id);
  elsif tg_op = 'DELETE' then
    perform private.sync_application_status(old.application_id);
  else
    perform private.sync_application_status(new.application_id);
  end if;
  return null;
end;
$$;

create trigger applications_status_sync
  after update on public.applications
  for each row
  when (old.status is distinct from new.status
        or old.payment_status is distinct from new.payment_status
        or old.form_locked is distinct from new.form_locked
        or old.appointment_status is distinct from new.appointment_status)
  execute function private.status_sync_trigger();
create trigger application_documents_status_sync
  after insert or update or delete on public.application_documents
  for each row execute function private.status_sync_trigger();
create trigger application_files_status_sync
  after insert or update or delete on public.application_files
  for each row execute function private.status_sync_trigger();
create trigger customer_tasks_status_sync
  after insert or update or delete on public.customer_tasks
  for each row execute function private.status_sync_trigger();

-- ---------------------------------------------------------------------------
-- 4. Application guard (replaces the definition in 20261013000200_security.sql). What's new:
--    * appointment location columns are closed to customers;
--    * "Müşteriden işlem bekleniyor" cannot happen without a verified payment either;
--    * staff only change the status by hand with these transitions: "Evraklar tamamlandı" (while under review and nothing
--      is expected from the customer) and undoing it, cancelling and undoing the cancellation. Every other transition follows from the rule;
--    * an appointment cannot be set to "sent" without an appointment date.
-- ---------------------------------------------------------------------------

create or replace function private.applications_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_privileged boolean := private.is_privileged();
  v_staff boolean := private.is_staff();
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if not v_privileged then
      if new.customer_id is distinct from v_uid then
        raise exception 'Başka bir kullanıcı adına başvuru oluşturulamaz.' using errcode = '42501';
      end if;
      if (select count(*) from public.applications a where a.customer_id = v_uid and a.status = 'draft') >= 5 then
        raise exception 'draft_limit_reached' using errcode = 'P0001',
          hint = 'Aynı anda en fazla 5 taslak başvuru bulunabilir.';
      end if;
      -- Protected fields sent by the client are ignored.
      new.reference_code := null;
      new.status := 'draft';
      new.form_locked := false;
      new.payment_status := 'not_due';
      new.payment_declared_at := null;
      new.payment_reviewed_at := null;
      new.payment_reviewed_by := null;
      new.payment_note := null;
      new.appointment_status := 'not_started';
      new.appointment_at := null;
      new.appointment_location := null;
      new.appointment_location_id := null;
      new.appointment_address := null;
      new.appointment_note := null;
      new.submitted_at := null;
      new.fees_snapshot_at := null;
      new.created_at := now();
    end if;
    if new.reference_code is null then
      new.reference_code := private.next_reference_code();
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  new.updated_at := now();

  if new.id is distinct from old.id
     or new.customer_id is distinct from old.customer_id
     or new.reference_code is distinct from old.reference_code
     or new.created_at is distinct from old.created_at then
    raise exception 'Başvurunun kimlik alanları değiştirilemez.' using errcode = '42501';
  end if;

  if not v_privileged and not v_staff then
    -- Customer: only in a draft and only the type / sponsor / city fields.
    if old.status <> 'draft' then
      raise exception 'application_not_editable' using errcode = '42501',
        hint = 'Gönderilmiş başvuru müşteri tarafından değiştirilemez.';
    end if;
    if new.status is distinct from old.status
       or new.form_locked is distinct from old.form_locked
       or new.payment_status is distinct from old.payment_status
       or new.payment_declared_at is distinct from old.payment_declared_at
       or new.payment_reviewed_at is distinct from old.payment_reviewed_at
       or new.payment_reviewed_by is distinct from old.payment_reviewed_by
       or new.payment_note is distinct from old.payment_note
       or new.appointment_status is distinct from old.appointment_status
       or new.appointment_at is distinct from old.appointment_at
       or new.appointment_location is distinct from old.appointment_location
       or new.appointment_location_id is distinct from old.appointment_location_id
       or new.appointment_address is distinct from old.appointment_address
       or new.appointment_note is distinct from old.appointment_note
       or new.submitted_at is distinct from old.submitted_at
       or new.fees_snapshot_at is distinct from old.fees_snapshot_at then
      raise exception 'protected_column' using errcode = '42501',
        hint = 'Durum, ödeme ve randevu alanları müşteri tarafından değiştirilemez.';
    end if;
  end if;

  if v_staff and not v_privileged then
    if new.status = 'draft' and old.status <> 'draft' then
      raise exception 'Gönderilmiş başvuru taslağa döndürülemez.' using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'cancelled' then
        if old.status in ('draft', 'result_communicated') then
          raise exception 'status_change_not_allowed' using errcode = 'P0001',
            hint = 'Taslak ve sonucu bildirilmiş başvuru iptal edilemez.';
        end if;
      elsif old.status = 'cancelled' then
        -- Undoing a cancellation: the status is recomputed with the rule below (sync).
        if new.status <> 'submitted' then
          raise exception 'status_change_not_allowed' using errcode = 'P0001';
        end if;
      elsif new.status = 'documents_complete' then
        if old.status <> 'in_review' then
          raise exception 'status_change_not_allowed' using errcode = 'P0001',
            hint = 'Evraklar yalnızca inceleme aşamasındaki başvuruda tamamlandı olarak işaretlenir.';
        end if;
        if private.customer_action_outstanding(new.id, new.form_locked) then
          raise exception 'customer_action_outstanding' using errcode = 'P0001',
            hint = 'Müşteriden beklenen işlemler tamamlanmadan evraklar tamamlandı olarak işaretlenemez.';
        end if;
      elsif not (old.status = 'documents_complete' and new.status = 'in_review') then
        raise exception 'status_change_not_allowed' using errcode = 'P0001',
          hint = 'Başvurunun durumu yapılan işlemlere göre kendiliğinden değişir.';
      end if;
    end if;
    if (new.appointment_status is distinct from old.appointment_status or new.appointment_at is distinct from old.appointment_at)
       and new.appointment_status = 'scheduled' and new.appointment_at is null then
      raise exception 'appointment_date_required' using errcode = 'P0001';
    end if;
    -- The staff member who decided on the payment and the time are stamped on the server.
    if new.payment_status is distinct from old.payment_status and new.payment_status in ('verified', 'rejected') then
      new.payment_reviewed_at := now();
      new.payment_reviewed_by := v_uid;
    end if;
  end if;

  -- Review and later stages cannot be reached without a verified payment (applies to everyone).
  if (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status)
     and new.status in ('in_review', 'awaiting_customer', 'documents_complete', 'awaiting_result', 'result_communicated')
     and new.payment_status <> 'verified' then
    raise exception 'payment_not_verified' using errcode = 'P0001',
      hint = 'Ödeme doğrulanmadan başvuru inceleme aşamasına alınamaz.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Visa outcome: since "Vize başvurusu yapıldı" is gone, the outcome can be recorded once the documents are complete
--    (even if the appointment is not in the system). The rest is the same as migration 20261014000300.
-- ---------------------------------------------------------------------------

create or replace function public.svc_set_visa_outcome(
  p_actor_id uuid,
  p_application_id uuid,
  p_outcome text,
  p_note text,
  p_file_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_previous uuid;
begin
  -- Session permissions cannot be trusted inside SECURITY DEFINER; that the actor is active staff is checked here.
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('approved', 'refused') then
    raise exception 'visa_outcome_invalid' using errcode = '22023';
  end if;
  if p_outcome = 'refused' and v_note is null then
    raise exception 'visa_outcome_note_required' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'visa_outcome_note_too_long' using errcode = '22023';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.status not in ('documents_complete', 'awaiting_result', 'result_communicated') then
    raise exception 'visa_outcome_not_allowed' using errcode = 'P0001';
  end if;
  if p_file_id is not null and not exists (
    select 1 from public.application_files f
    where f.id = p_file_id and f.application_id = p_application_id and f.kind = 'visa_result' and f.status = 'ready'
  ) then
    raise exception 'visa_outcome_file_invalid' using errcode = 'P0001';
  end if;

  v_previous := v_app.visa_outcome_file_id;

  -- If the payment is not verified applications_guard rejects this update (payment_not_verified).
  update public.applications
     set visa_outcome = p_outcome,
         visa_outcome_note = v_note,
         visa_outcome_file_id = p_file_id,
         visa_outcome_at = now(),
         status = 'result_communicated'
   where id = p_application_id;

  -- The audit trigger does not write changes made with the service role; the entries are written here.
  if v_app.status <> 'result_communicated' then
    perform private.write_audit(p_actor_id, 'application.status_changed', p_application_id, 'application', p_application_id::text,
      jsonb_build_object('from', v_app.status, 'to', 'result_communicated'));
  end if;
  perform private.write_audit(p_actor_id, 'application.visa_outcome_set', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('outcome', p_outcome, 'with_file', p_file_id is not null));

  return case when v_previous is distinct from p_file_id then v_previous else null end;
end;
$$;

revoke all on function public.svc_set_visa_outcome(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.svc_set_visa_outcome(uuid, uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Appointment took place (scheduled job)
-- ---------------------------------------------------------------------------

-- Sets appointments in the "Randevu tarihi bildirildi" status whose day (Istanbul time) has passed to "Randevu gerçekleşti";
-- the application moves to "Sonuç bekleniyor" according to the rule and the customer is notified. Returns the number of applications processed.
-- Called hourly by Supabase's scheduled job (pg_cron): supabase/cron/complete-past-appointments.sql.
create or replace function private.complete_past_appointments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  for v_row in
    select a.id, a.customer_id
    from public.applications a
    where a.appointment_status = 'scheduled'
      and a.appointment_at is not null
      and (a.appointment_at at time zone 'Europe/Istanbul')::date < v_today
      and a.status not in ('draft', 'cancelled', 'result_communicated')
    for update
  loop
    update public.applications set appointment_status = 'completed' where id = v_row.id;
    perform private.write_audit(null, 'appointment.completed', v_row.id, 'application', v_row.id::text, '{}'::jsonb);
    insert into public.notifications (user_id, application_id, kind, title, body)
    values (v_row.customer_id, v_row.id, 'appointment.completed', 'Randevunuz gerçekleşti',
            'Vize kararını yetkili makam verir. Sonuç açıklandığında size bildirilecektir.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- New private functions are not open to sessions (only triggers, the scheduled job and the service role).
-- The only exception is customer_action_outstanding: applications_guard runs with the staff session and calls it in the
-- "Evraklar tamamlandı" check (the private schema is not exposed to the API; same as owns_application).
revoke all on function private.customer_action_outstanding(uuid, boolean) from public, anon;
revoke all on function private.next_application_status(text, text, text, boolean) from public, anon, authenticated;
revoke all on function private.sync_application_status(uuid) from public, anon, authenticated;
revoke all on function private.status_sync_trigger() from public, anon, authenticated;
revoke all on function private.complete_past_appointments() from public, anon, authenticated;
grant execute on function private.customer_action_outstanding(uuid, boolean) to authenticated, service_role;
grant execute on function private.next_application_status(text, text, text, boolean) to service_role;
grant execute on function private.sync_application_status(uuid) to service_role;
grant execute on function private.complete_past_appointments() to service_role;

-- ---------------------------------------------------------------------------
-- 7. The status of existing applications is computed once with the new rule (changes go into the audit log as "Sistem").
-- ---------------------------------------------------------------------------

do $$
begin
  perform private.sync_application_status(a.id)
  from public.applications a
  where a.status not in ('draft', 'cancelled', 'result_communicated');
end;
$$;

-- >>> 20261019000100_drafts_reopen.sql
-- =============================================================================
-- Migration 13: undoing a cancellation returns to the previous stage; customers delete their drafts
-- =============================================================================
-- Problem and decision:
--   1. An application that had reached the appointment stage went back to "review" when it was cancelled and the
--      cancellation was undone. Now the application's stage at the moment of cancellation is stored and undoing returns
--      to that stage (the automatic status rule still applies: e.g. "Müşteriden işlem bekleniyor" if something is expected from the customer).
--   2. A customer can delete an unsubmitted draft ("Taslağı sil"). A submitted application cannot be deleted.
--
-- DATA: no row is changed or deleted; only a column and a function are added and the application guard
-- is redefined. If run a second time it stops with an "already exists" error on the first statement.

alter table public.applications
  add column cancelled_from_status text check (
    cancelled_from_status in ('submitted', 'in_review', 'awaiting_customer', 'documents_complete', 'awaiting_result')
  );
-- No session gets a write grant; the application guard (trigger) writes the value.

-- ---------------------------------------------------------------------------
-- 1. Application guard (replaces the definition in 20261016000200_automatic_status.sql). What's new:
--    * on cancellation the current stage is written to the cancelled_from_status column;
--    * when the cancellation is undone (staff set the status to "submitted") it returns to the stored stage; if the
--      payment became unverified in the meantime it becomes "Başvuru gönderildi". Then the automatic status rule is applied.
-- ---------------------------------------------------------------------------

create or replace function private.applications_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_privileged boolean := private.is_privileged();
  v_staff boolean := private.is_staff();
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if not v_privileged then
      if new.customer_id is distinct from v_uid then
        raise exception 'Başka bir kullanıcı adına başvuru oluşturulamaz.' using errcode = '42501';
      end if;
      if (select count(*) from public.applications a where a.customer_id = v_uid and a.status = 'draft') >= 5 then
        raise exception 'draft_limit_reached' using errcode = 'P0001',
          hint = 'Aynı anda en fazla 5 taslak başvuru bulunabilir.';
      end if;
      -- Protected fields sent by the client are ignored.
      new.reference_code := null;
      new.status := 'draft';
      new.form_locked := false;
      new.payment_status := 'not_due';
      new.payment_declared_at := null;
      new.payment_reviewed_at := null;
      new.payment_reviewed_by := null;
      new.payment_note := null;
      new.appointment_status := 'not_started';
      new.appointment_at := null;
      new.appointment_location := null;
      new.appointment_location_id := null;
      new.appointment_address := null;
      new.appointment_note := null;
      new.submitted_at := null;
      new.fees_snapshot_at := null;
      new.cancelled_from_status := null;
      new.created_at := now();
    end if;
    if new.reference_code is null then
      new.reference_code := private.next_reference_code();
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  new.updated_at := now();

  if new.id is distinct from old.id
     or new.customer_id is distinct from old.customer_id
     or new.reference_code is distinct from old.reference_code
     or new.created_at is distinct from old.created_at then
    raise exception 'Başvurunun kimlik alanları değiştirilemez.' using errcode = '42501';
  end if;

  if not v_privileged and not v_staff then
    -- Customer: only in a draft and only the type / sponsor / city fields.
    if old.status <> 'draft' then
      raise exception 'application_not_editable' using errcode = '42501',
        hint = 'Gönderilmiş başvuru müşteri tarafından değiştirilemez.';
    end if;
    if new.status is distinct from old.status
       or new.form_locked is distinct from old.form_locked
       or new.payment_status is distinct from old.payment_status
       or new.payment_declared_at is distinct from old.payment_declared_at
       or new.payment_reviewed_at is distinct from old.payment_reviewed_at
       or new.payment_reviewed_by is distinct from old.payment_reviewed_by
       or new.payment_note is distinct from old.payment_note
       or new.appointment_status is distinct from old.appointment_status
       or new.appointment_at is distinct from old.appointment_at
       or new.appointment_location is distinct from old.appointment_location
       or new.appointment_location_id is distinct from old.appointment_location_id
       or new.appointment_address is distinct from old.appointment_address
       or new.appointment_note is distinct from old.appointment_note
       or new.submitted_at is distinct from old.submitted_at
       or new.fees_snapshot_at is distinct from old.fees_snapshot_at
       or new.cancelled_from_status is distinct from old.cancelled_from_status then
      raise exception 'protected_column' using errcode = '42501',
        hint = 'Durum, ödeme ve randevu alanları müşteri tarafından değiştirilemez.';
    end if;
  end if;

  if v_staff and not v_privileged then
    if new.status = 'draft' and old.status <> 'draft' then
      raise exception 'Gönderilmiş başvuru taslağa döndürülemez.' using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'cancelled' then
        if old.status in ('draft', 'result_communicated') then
          raise exception 'status_change_not_allowed' using errcode = 'P0001',
            hint = 'Taslak ve sonucu bildirilmiş başvuru iptal edilemez.';
        end if;
        -- Stage to return to when the cancellation is undone.
        new.cancelled_from_status := old.status;
      elsif old.status = 'cancelled' then
        -- Undoing a cancellation: return to the stored stage; the status is then recomputed with the automatic rule (sync).
        if new.status <> 'submitted' then
          raise exception 'status_change_not_allowed' using errcode = 'P0001';
        end if;
        new.status := coalesce(old.cancelled_from_status, 'submitted');
        if new.status <> 'submitted' and new.payment_status <> 'verified' then
          new.status := 'submitted';
        end if;
        new.cancelled_from_status := null;
      elsif new.status = 'documents_complete' then
        if old.status <> 'in_review' then
          raise exception 'status_change_not_allowed' using errcode = 'P0001',
            hint = 'Evraklar yalnızca inceleme aşamasındaki başvuruda tamamlandı olarak işaretlenir.';
        end if;
        if private.customer_action_outstanding(new.id, new.form_locked) then
          raise exception 'customer_action_outstanding' using errcode = 'P0001',
            hint = 'Müşteriden beklenen işlemler tamamlanmadan evraklar tamamlandı olarak işaretlenemez.';
        end if;
      elsif not (old.status = 'documents_complete' and new.status = 'in_review') then
        raise exception 'status_change_not_allowed' using errcode = 'P0001',
          hint = 'Başvurunun durumu yapılan işlemlere göre kendiliğinden değişir.';
      end if;
    end if;
    if (new.appointment_status is distinct from old.appointment_status or new.appointment_at is distinct from old.appointment_at)
       and new.appointment_status = 'scheduled' and new.appointment_at is null then
      raise exception 'appointment_date_required' using errcode = 'P0001';
    end if;
    -- The staff member who decided on the payment and the time are stamped on the server.
    if new.payment_status is distinct from old.payment_status and new.payment_status in ('verified', 'rejected') then
      new.payment_reviewed_at := now();
      new.payment_reviewed_by := v_uid;
    end if;
  end if;

  -- Review and later stages cannot be reached without a verified payment (applies to everyone).
  if (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status)
     and new.status in ('in_review', 'awaiting_customer', 'documents_complete', 'awaiting_result', 'result_communicated')
     and new.payment_status <> 'verified' then
    raise exception 'payment_not_verified' using errcode = 'P0001',
      hint = 'Ödeme doğrulanmadan başvuru inceleme aşamasına alınamaz.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Customer deleting their draft
-- ---------------------------------------------------------------------------
-- The server calls it with the service role after verifying the customer's identity. The function also enforces the rule
-- in the database: the actor must own the application and the application must be a draft. Returns the storage paths of
-- the deleted files; the server deletes the objects in storage. Form answers, document slots, file records, appointment
-- preferences and notifications are deleted with the application. Who deleted it is written to the audit log (no name or form content).
create function public.svc_delete_draft(p_actor_id uuid, p_application_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_app.status <> 'draft' then
    raise exception 'not_a_draft' using errcode = 'P0001';
  end if;

  return query select f.storage_path from public.application_files f where f.application_id = p_application_id;

  -- Written before the record is deleted; once the application is deleted the entry's application link is cleared and the id text remains.
  perform private.write_audit(p_actor_id, 'application.draft_deleted', p_application_id, 'application', p_application_id::text, '{}'::jsonb);
  delete from public.applications where id = p_application_id;
end;
$$;

revoke all on function public.svc_delete_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_delete_draft(uuid, uuid) to service_role;

-- >>> 20261019000200_reminders_email.sql
-- =============================================================================
-- Migration 14: customer reminder record and e-mail notifications
-- =============================================================================
-- Scope:
--   1. The "Müşteriye hatırlat" (remind customer) button in the admin panel sends the customer a notification and is recorded
--      in the audit log as "customer.reminded" ("Son hatırlatma: …" is read from this entry).
--   2. Every in-app notification sent to the customer is also sent as an e-mail. The server does the sending
--      (SMTP details are in server environment variables); the database only tracks which notification was sent.
--
-- DATA: no row is changed or deleted; three columns and two server functions are added to the notifications table,
-- and record_staff_event is redefined. If run a second time it stops with an "already exists" error on the first statement.

alter table public.notifications
  add column email_attempts smallint not null default 0 check (email_attempts between 0 and 20),
  add column email_claimed_at timestamptz,
  add column email_error text check (char_length(email_error) <= 300);
-- No new grant is given to sessions: the customer can only change the read_at column (migration 2).

-- To find notifications waiting to be sent quickly.
create index notifications_email_pending_idx on public.notifications (created_at) where email_sent_at is null;

-- ---------------------------------------------------------------------------
-- 1. Server-side event record for staff ("customer.reminded" added; replaces the definition in migration 2).
-- ---------------------------------------------------------------------------
create or replace function public.record_staff_event(
  p_action text,
  p_application_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_action !~ '^(export|form_pdf|file|customer)\.[a-z_]{1,40}$' then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  perform private.write_audit((select auth.uid()), p_action, p_application_id, 'application', p_application_id::text, p_details);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. E-mail queue. Called ONLY by the service role (the server, right before and after sending).
--    * Notifications created in the last two days, not sent, tried fewer than 5 times are taken. Older notifications
--      are not sent as e-mail (so old notifications are not sent in bulk once SMTP is configured later).
--    * A taken row is not taken by another sender for 10 minutes (so the same e-mail is not sent twice).
-- ---------------------------------------------------------------------------
create or replace function public.svc_claim_notification_emails(p_limit integer default 20)
returns table (
  id uuid,
  kind text,
  title text,
  body text,
  application_id uuid,
  created_at timestamptz,
  email text,
  first_name text,
  reference_code text
)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select n.id
    from public.notifications n
    where n.email_sent_at is null
      and n.email_attempts < 5
      and n.created_at > now() - interval '2 days'
      and (n.email_claimed_at is null or n.email_claimed_at < now() - interval '10 minutes')
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of n skip locked
  ),
  claimed as (
    update public.notifications n
    set email_claimed_at = now(), email_attempts = n.email_attempts + 1
    from picked
    where n.id = picked.id
    returning n.id, n.kind, n.title, n.body, n.application_id, n.created_at, n.user_id
  )
  select c.id, c.kind, c.title, c.body, c.application_id, c.created_at, p.email, p.first_name, a.reference_code
  from claimed c
  join public.profiles p on p.id = c.user_id
  left join public.applications a on a.id = c.application_id
  order by c.created_at;
$$;

create or replace function public.svc_finish_notification_email(p_id uuid, p_sent boolean, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set email_sent_at = case when p_sent then now() else null end,
      email_claimed_at = case when p_sent then email_claimed_at else null end,
      email_error = case when p_sent then null else left(coalesce(nullif(p_error, ''), 'unknown'), 300) end
  where id = p_id;
$$;

revoke all on function public.svc_claim_notification_emails(integer) from public, anon, authenticated;
revoke all on function public.svc_finish_notification_email(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.svc_claim_notification_emails(integer) to service_role;
grant execute on function public.svc_finish_notification_email(uuid, boolean, text) to service_role;

-- >>> 20261020000100_staff_mfa.sql
-- =============================================================================
-- Migration 15: two-factor authentication mandatory for staff
-- =============================================================================
-- consultant accounts can access every customer's documents, so the data must stay out of reach even if a password
-- is stolen. Staff permissions are only granted in a session that passed two-factor authentication (the code from the
-- authenticator app was entered). The app applies the same rule (src/server/auth.ts); this file makes the
-- database the last line of defense: a staff session without the code that sends requests directly to the API
-- looks like an ordinary user (it cannot see or change someone else's application, files or notes).
--
-- DATA: no row is changed or deleted. If run a second time it stops with an "already exists" error on the first statement.
--
-- IMPORTANT: After this file is run, staff must set up two-factor authentication before entering the admin panel
-- (after signing in the app opens the setup page by itself). In the Supabase dashboard, "TOTP" must be enabled under
-- Authentication → Multi-Factor (it is enabled by default).

-- ---------------------------------------------------------------------------
-- 1. Record of resetting a staff member's two-factor authentication (Settings → Staff). Called ONLY by the service role;
--    the server calls it after verifying the acting staff member's permission. Who reset whose authentication
--    is written to the audit log.
-- ---------------------------------------------------------------------------
create function public.svc_record_staff_security_event(p_actor_id uuid, p_action text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action is distinct from 'staff.mfa_reset' then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_target_id and p.role = 'staff') then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;
  perform private.write_audit(p_actor_id, p_action, null, 'profile', p_target_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.svc_record_staff_security_event(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.svc_record_staff_security_event(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Staff permission (replaces the definition in migration 2): an active staff account AND a session with two-factor authentication.
--    The "aal" value in the access token is read from the token signed by Supabase Auth; the client cannot change it.
--    RLS policies, the storage policy, triggers and staff functions use this function.
-- ---------------------------------------------------------------------------
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'staff' and p.is_active
    );
$$;

-- >>> 20261020000200_retention.sql
-- =============================================================================
-- Migration 16: retention period and automatic deletion of closed applications
-- =============================================================================
-- applications that were concluded or cancelled should be deleted automatically once the set period has
-- passed; the period is entered in Settings → General; until it is entered
-- NOTHING is deleted (the setting is empty).
--
-- For an expired application the documents (from storage), form answers, document and file records, appointment preferences,
-- messages, internal notes, tasks and notifications are permanently deleted. Only the application number is written to the
-- audit log (no personal data). The customer's account is not deleted.
--
-- The server does the deletion: first it fetches the expired applications and file paths, deletes the files in storage, then
-- deletes the application (both functions are called only with the service role and re-check the condition in the database).
--
-- DATA: this file deletes no rows; it only adds one (empty) settings row and two functions. If run a second time
-- it stops with an "already exists" error on the first statement.

-- Moment of closing: when the result was sent if it was sent, the last update if cancelled.
create function public.svc_expired_applications(p_limit integer default 20)
returns table (application_id uuid, reference_code text, storage_paths text[])
language sql
stable
security definer
set search_path = ''
as $$
  with setting as (
    select (s.value #>> '{}')::integer as months
    from public.settings s
    where s.key = 'retention.closed_months' and jsonb_typeof(s.value) = 'number'
  )
  select a.id, a.reference_code,
         coalesce(array_agg(f.storage_path order by f.storage_path) filter (where f.storage_path is not null), '{}'::text[])
  from public.applications a
  cross join setting st
  left join public.application_files f on f.application_id = a.id
  where st.months between 1 and 240
    and a.status in ('result_communicated', 'cancelled')
    and coalesce(a.visa_outcome_at, a.updated_at) < now() - make_interval(months => st.months)
  group by a.id, a.reference_code, a.visa_outcome_at, a.updated_at
  order by coalesce(a.visa_outcome_at, a.updated_at)
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create function public.svc_delete_expired_application(p_application_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_months integer;
begin
  select (s.value #>> '{}')::integer into v_months
  from public.settings s
  where s.key = 'retention.closed_months' and jsonb_typeof(s.value) = 'number';
  if v_months is null or v_months not between 1 and 240 then
    return false;
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    return false;
  end if;
  if v_app.status not in ('result_communicated', 'cancelled')
     or coalesce(v_app.visa_outcome_at, v_app.updated_at) >= now() - make_interval(months => v_months) then
    return false;
  end if;

  -- Written before the record is deleted; once the application is deleted the link is cleared and the application number remains.
  perform private.write_audit(null, 'application.retention_deleted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('reference_code', v_app.reference_code, 'months', v_months));
  delete from public.applications where id = p_application_id;
  return true;
end;
$$;

revoke all on function public.svc_expired_applications(integer) from public, anon, authenticated;
revoke all on function public.svc_delete_expired_application(uuid) from public, anon, authenticated;
grant execute on function public.svc_expired_applications(integer) to service_role;
grant execute on function public.svc_delete_expired_application(uuid) to service_role;

-- Retention period setting (months). Empty (null) = automatic deletion off. Only staff can see and change it.
insert into public.settings (key, value, visibility) values ('retention.closed_months', 'null', 'staff')
on conflict (key) do nothing;

-- >>> 20261020000300_form_requests_maps.sql
-- =============================================================================
-- Migration 17: form edit request, "Formu düzenlemeyi tamamladım", map link of the appointment location,
--            the Fee step's mark, and a public "brand" bucket for the e-mail logo
-- =============================================================================
-- Problems fixed:
--   1. A customer can ask their consultant to allow changes to the form of a submitted application. The consultant
--      opens the form for editing or refuses the request with a reason.
--   2. When the consultant opens the form for correction, the customer can say "Formu düzenlemeyi tamamladım" once done:
--      the form locks again and the correction notice disappears; if nothing else is expected from the customer the status
--      rule moves the application to "İnceleme aşamasında" by itself.
--   3. A Google Maps link the consultant enters for each appointment location; the customer's "Haritada aç" button only
--      opens this link (a copy is written to the application when it is picked from the location list, like the address).
--   4. In a draft, the "Ücret" (fee) step's mark turns green once the customer opens that page (it is not considered complete by itself).
--   5. The real logo in Supabase's own e-mails (sign-up confirmation, password reset): a public "brand" bucket.
--      Only the server (service role) uploads to it; it contains only the logo, never personal data.
--
-- DATA: no row is changed or deleted; columns, two functions and a bucket are added and the application guard is
-- redefined. If run a second time it stops with an "already exists" error on the first statement.

alter table public.applications
  add column fee_step_seen_at timestamptz,
  add column form_edit_requested_at timestamptz,
  add column form_edit_request_note text check (char_length(form_edit_request_note) <= 1000),
  add column appointment_maps_url text check (char_length(appointment_maps_url) <= 2000 and appointment_maps_url ~ '^https://[^[:space:]]+$');

alter table public.appointment_locations
  add column maps_url text check (char_length(maps_url) <= 2000 and maps_url ~ '^https://[^[:space:]]+$');

-- In a draft the customer can only write fee_step_seen_at (the application guard blocks the others); staff close the form
-- edit request and write the appointment's map link. appointment_locations is granted at table level.
grant update (fee_step_seen_at, form_edit_requested_at, form_edit_request_note, appointment_maps_url) on public.applications to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Application guard (replaces the definition in 20261019000100_drafts_reopen.sql). What's new:
--    * the form edit request and the appointment's map link are closed to customers (the request only via svc_request_form_edit);
--    * when the form is opened for editing, a pending form edit request closes by itself.
-- ---------------------------------------------------------------------------

create or replace function private.applications_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_privileged boolean := private.is_privileged();
  v_staff boolean := private.is_staff();
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if not v_privileged then
      if new.customer_id is distinct from v_uid then
        raise exception 'Başka bir kullanıcı adına başvuru oluşturulamaz.' using errcode = '42501';
      end if;
      if (select count(*) from public.applications a where a.customer_id = v_uid and a.status = 'draft') >= 5 then
        raise exception 'draft_limit_reached' using errcode = 'P0001',
          hint = 'Aynı anda en fazla 5 taslak başvuru bulunabilir.';
      end if;
      -- Protected fields sent by the client are ignored.
      new.reference_code := null;
      new.status := 'draft';
      new.form_locked := false;
      new.payment_status := 'not_due';
      new.payment_declared_at := null;
      new.payment_reviewed_at := null;
      new.payment_reviewed_by := null;
      new.payment_note := null;
      new.appointment_status := 'not_started';
      new.appointment_at := null;
      new.appointment_location := null;
      new.appointment_location_id := null;
      new.appointment_address := null;
      new.appointment_maps_url := null;
      new.appointment_note := null;
      new.submitted_at := null;
      new.fees_snapshot_at := null;
      new.cancelled_from_status := null;
      new.fee_step_seen_at := null;
      new.form_edit_requested_at := null;
      new.form_edit_request_note := null;
      new.created_at := now();
    end if;
    if new.reference_code is null then
      new.reference_code := private.next_reference_code();
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  new.updated_at := now();

  if new.id is distinct from old.id
     or new.customer_id is distinct from old.customer_id
     or new.reference_code is distinct from old.reference_code
     or new.created_at is distinct from old.created_at then
    raise exception 'Başvurunun kimlik alanları değiştirilemez.' using errcode = '42501';
  end if;

  if not v_privileged and not v_staff then
    -- Customer: only in a draft and only the type / sponsor / city fields and the moment the Fee step was seen.
    if old.status <> 'draft' then
      raise exception 'application_not_editable' using errcode = '42501',
        hint = 'Gönderilmiş başvuru müşteri tarafından değiştirilemez.';
    end if;
    if new.status is distinct from old.status
       or new.form_locked is distinct from old.form_locked
       or new.payment_status is distinct from old.payment_status
       or new.payment_declared_at is distinct from old.payment_declared_at
       or new.payment_reviewed_at is distinct from old.payment_reviewed_at
       or new.payment_reviewed_by is distinct from old.payment_reviewed_by
       or new.payment_note is distinct from old.payment_note
       or new.appointment_status is distinct from old.appointment_status
       or new.appointment_at is distinct from old.appointment_at
       or new.appointment_location is distinct from old.appointment_location
       or new.appointment_location_id is distinct from old.appointment_location_id
       or new.appointment_address is distinct from old.appointment_address
       or new.appointment_maps_url is distinct from old.appointment_maps_url
       or new.appointment_note is distinct from old.appointment_note
       or new.submitted_at is distinct from old.submitted_at
       or new.fees_snapshot_at is distinct from old.fees_snapshot_at
       or new.cancelled_from_status is distinct from old.cancelled_from_status
       or new.form_edit_requested_at is distinct from old.form_edit_requested_at
       or new.form_edit_request_note is distinct from old.form_edit_request_note then
      raise exception 'protected_column' using errcode = '42501',
        hint = 'Durum, ödeme ve randevu alanları müşteri tarafından değiştirilemez.';
    end if;
  end if;

  if v_staff and not v_privileged then
    if new.status = 'draft' and old.status <> 'draft' then
      raise exception 'Gönderilmiş başvuru taslağa döndürülemez.' using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'cancelled' then
        if old.status in ('draft', 'result_communicated') then
          raise exception 'status_change_not_allowed' using errcode = 'P0001',
            hint = 'Taslak ve sonucu bildirilmiş başvuru iptal edilemez.';
        end if;
        -- Stage to return to when the cancellation is undone.
        new.cancelled_from_status := old.status;
      elsif old.status = 'cancelled' then
        -- Undoing a cancellation: return to the stored stage; the status is then recomputed with the automatic rule (sync).
        if new.status <> 'submitted' then
          raise exception 'status_change_not_allowed' using errcode = 'P0001';
        end if;
        new.status := coalesce(old.cancelled_from_status, 'submitted');
        if new.status <> 'submitted' and new.payment_status <> 'verified' then
          new.status := 'submitted';
        end if;
        new.cancelled_from_status := null;
      elsif new.status = 'documents_complete' then
        if old.status <> 'in_review' then
          raise exception 'status_change_not_allowed' using errcode = 'P0001',
            hint = 'Evraklar yalnızca inceleme aşamasındaki başvuruda tamamlandı olarak işaretlenir.';
        end if;
        if private.customer_action_outstanding(new.id, new.form_locked) then
          raise exception 'customer_action_outstanding' using errcode = 'P0001',
            hint = 'Müşteriden beklenen işlemler tamamlanmadan evraklar tamamlandı olarak işaretlenemez.';
        end if;
      elsif not (old.status = 'documents_complete' and new.status = 'in_review') then
        raise exception 'status_change_not_allowed' using errcode = 'P0001',
          hint = 'Başvurunun durumu yapılan işlemlere göre kendiliğinden değişir.';
      end if;
    end if;
    if (new.appointment_status is distinct from old.appointment_status or new.appointment_at is distinct from old.appointment_at)
       and new.appointment_status = 'scheduled' and new.appointment_at is null then
      raise exception 'appointment_date_required' using errcode = 'P0001';
    end if;
    -- The staff member who decided on the payment and the time are stamped on the server.
    if new.payment_status is distinct from old.payment_status and new.payment_status in ('verified', 'rejected') then
      new.payment_reviewed_at := now();
      new.payment_reviewed_by := v_uid;
    end if;
  end if;

  -- When the form is opened for editing, a pending form edit request counts as fulfilled (applies to everyone).
  if old.form_locked and not new.form_locked then
    new.form_edit_requested_at := null;
    new.form_edit_request_note := null;
  end if;

  -- Review and later stages cannot be reached without a verified payment (applies to everyone).
  if (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status)
     and new.status in ('in_review', 'awaiting_customer', 'documents_complete', 'awaiting_result', 'result_communicated')
     and new.payment_status <> 'verified' then
    raise exception 'payment_not_verified' using errcode = 'P0001',
      hint = 'Ödeme doğrulanmadan başvuru inceleme aşamasına alınamaz.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The customer's form edit request and "Formu düzenlemeyi tamamladım"
-- ---------------------------------------------------------------------------
-- The customer's session cannot change a submitted application (guard). The server calls these with the service role after
-- verifying the customer's identity; the functions also enforce the rule in the database: the actor must own the application.
-- The request text is not written to the audit log (it may contain personal information); the consultant reads it on the application itself.

create function public.svc_request_form_edit(p_actor_id uuid, p_application_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Changing the form after the appointment makes no sense; it cannot be requested for cancelled or concluded applications either.
  if v_app.status not in ('submitted', 'in_review', 'awaiting_customer', 'documents_complete') then
    raise exception 'form_edit_request_not_allowed' using errcode = 'P0001';
  end if;
  if not v_app.form_locked then
    raise exception 'form_already_open' using errcode = 'P0001';
  end if;
  if v_app.form_edit_requested_at is not null then
    raise exception 'form_edit_already_requested' using errcode = 'P0001';
  end if;
  if char_length(v_note) not between 1 and 1000 then
    raise exception 'form_edit_note_invalid' using errcode = '22023';
  end if;

  update public.applications
    set form_edit_requested_at = now(), form_edit_request_note = v_note
    where id = p_application_id;
  perform private.write_audit(p_actor_id, 'form.edit_requested', p_application_id, 'application', p_application_id::text, '{}'::jsonb);
end;
$$;

create function public.svc_finish_form_correction(p_actor_id uuid, p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_app.status in ('draft', 'cancelled', 'result_communicated') or v_app.form_locked then
    raise exception 'form_correction_not_open' using errcode = 'P0001';
  end if;

  -- When the lock changes, the status rule (applications_status_sync) updates the application's stage by itself.
  update public.applications set form_locked = true where id = p_application_id;
  perform private.write_audit(p_actor_id, 'form.correction_finished', p_application_id, 'application', p_application_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.svc_request_form_edit(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.svc_finish_form_correction(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_request_form_edit(uuid, uuid, text) to service_role;
grant execute on function public.svc_finish_form_correction(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Public bucket for the e-mail logo
-- ---------------------------------------------------------------------------
-- Supabase's sign-up confirmation and password reset e-mails must show the logo from a public address (the site is not
-- live yet). This bucket contains only the logo PNG; reading is public, there is no write policy (only the
-- service role uploads it). Application files stay in the private "application-files" bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand', 'brand', true, 524288, array['image/png'])
on conflict (id) do nothing;

-- >>> 20261020000400_staff_admin.sql
-- =============================================================================
-- Migration 18: "Admin" rights for staff
-- =============================================================================
-- inviting new staff, disabling/enabling a staff member's access, resetting their two-factor
-- authentication and granting/revoking admin rights are admin-only. Other actions (applications,
-- settings) stay the same for all staff.
--
--   * profiles.is_admin: is the user an admin? Sessions have no write grant on this column (on profiles only the first
--     name, last name and date of birth can be written); only svc_set_staff_admin changes its value.
--   * Staff who are ACTIVE at the moment this file runs become admins. Staff invited
--     later are not admins; an admin grants the right from Settings → Staff.
--   * svc_set_staff_access (invitation and access on/off) and svc_record_staff_security_event (authentication reset record)
--     require the actor to be an active admin. The actor can be empty (null) only in the setup script on the
--     server (npm run staff:create; only the service role can call it).
--   * Nobody can remove their own admin rights; admin changes are written to the audit log.
--
-- DATA: no row is deleted; only active staff rows get is_admin = true. If run a second time it stops with an
-- "already exists" error on the first statement.

alter table public.profiles add column is_admin boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. Audit record of profile changes (replaces the definition in migration 2): admin changes are recorded too.
-- ---------------------------------------------------------------------------
create or replace function private.profiles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- svc_* functions report the acting staff member via app.actor_id.
  v_actor uuid := coalesce((select auth.uid()), nullif(current_setting('app.actor_id', true), '')::uuid);
begin
  new.updated_at := now();
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    perform private.write_audit(
      v_actor, 'staff.access_changed', null, 'profile', new.id::text,
      jsonb_build_object('role_from', old.role, 'role_to', new.role, 'active_from', old.is_active, 'active_to', new.is_active)
    );
  end if;
  if new.is_admin is distinct from old.is_admin then
    perform private.write_audit(v_actor, 'staff.admin_changed', null, 'profile', new.id::text, jsonb_build_object('admin_to', new.is_admin));
  end if;
  return new;
end;
$$;

-- Staff active when this file runs become admins.
update public.profiles set is_admin = true where role = 'staff' and is_active;

-- ---------------------------------------------------------------------------
-- 2. Granting/revoking staff rights (replaces the definition in migration 2): the actor must be an active admin.
--    A person whose staff rights are removed also loses admin rights.
-- ---------------------------------------------------------------------------
create or replace function public.svc_set_staff_access(
  p_actor_id uuid,
  p_user_id uuid,
  p_role text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_role not in ('customer', 'staff') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_actor_id is not null
     and not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_actor_id is not null and p_actor_id = p_user_id and (p_role <> 'staff' or not p_is_active) then
    raise exception 'cannot_change_own_access' using errcode = 'P0001';
  end if;
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  update public.profiles
    set role = p_role, is_active = p_is_active, is_admin = (p_role = 'staff' and is_admin)
    where id = p_user_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Granting/revoking admin rights. Called ONLY by the service role; the server calls it after verifying the actor's identity.
-- ---------------------------------------------------------------------------
create function public.svc_set_staff_admin(p_actor_id uuid, p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_is_admin is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if p_actor_id is not null
     and not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_actor_id is not null and p_actor_id = p_user_id and not p_is_admin then
    raise exception 'cannot_change_own_access' using errcode = 'P0001';
  end if;
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  update public.profiles set is_admin = p_is_admin where id = p_user_id and role = 'staff';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.svc_set_staff_admin(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.svc_set_staff_admin(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Two-factor authentication reset record (replaces the definition in migration 15): the actor must be an active admin.
-- ---------------------------------------------------------------------------
create or replace function public.svc_record_staff_security_event(p_actor_id uuid, p_action text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action is distinct from 'staff.mfa_reset' then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_target_id and p.role = 'staff') then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;
  perform private.write_audit(p_actor_id, p_action, null, 'profile', p_target_id::text, '{}'::jsonb);
end;
$$;

-- >>> 20261020000500_appointment_completion.sql
-- =============================================================================
-- Migration 19: "Randevu gerçekleşti" once the appointment time has passed
-- =============================================================================
-- Problem fixed: the application did not move to "Randevu gerçekleşti" / "Sonuç bekleniyor" even though the
-- appointment had passed. There were two reasons:
--   1. The rule was "once the appointment DAY has passed" (the appointment waited until the next day).
--   2. The transition was only done by a scheduled job (pg_cron) that has to be set up separately in Supabase; it had not been set up.
-- Now the transition happens once the appointment TIME has passed, and the app also does it when pages open (at most once a minute):
-- svc_complete_past_appointments is only called with the service role. If the scheduled job is set up it runs as a backup.
--
-- DATA: no row is deleted. The functions are redefined; on the first call sent appointments whose time has passed
-- become "Randevu gerçekleşti" and the customer is notified (as the rule requires). If run a second time it stops with
-- an "already exists" error on the second function.

-- Sets appointments in the "Randevu tarihi bildirildi" status whose time (Istanbul) has passed to "Randevu gerçekleşti"; the
-- application moves to "Sonuç bekleniyor" according to the rule and the customer is notified. Returns the number of applications processed.
create or replace function private.complete_past_appointments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select a.id, a.customer_id
    from public.applications a
    where a.appointment_status = 'scheduled'
      and a.appointment_at is not null
      and a.appointment_at <= now()
      and a.status not in ('draft', 'cancelled', 'result_communicated')
    for update skip locked
  loop
    update public.applications set appointment_status = 'completed' where id = v_row.id;
    perform private.write_audit(null, 'appointment.completed', v_row.id, 'application', v_row.id::text, '{}'::jsonb);
    insert into public.notifications (user_id, application_id, kind, title, body)
    values (v_row.customer_id, v_row.id, 'appointment.completed', 'Randevunuz gerçekleşti',
            'Vize kararını yetkili makam verir. Sonuç açıklandığında size bildirilecektir.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Entry point called by the app (server, service role). Not open to any session.
create function public.svc_complete_past_appointments()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.complete_past_appointments();
$$;

revoke all on function public.svc_complete_past_appointments() from public, anon, authenticated;
grant execute on function public.svc_complete_past_appointments() to service_role;

-- >>> 20261020000600_document_rules_order_preferences.sql
-- =============================================================================
-- Migration 20: document rules by application type combination, ordering, a single appointment preference
-- =============================================================================
-- Scope:
--   1. Which documents are required in which application is set in Settings, by application type COMBINATIONS
--      (e.g. these documents for "Öğrenci", and these in addition when "Öğrenci + Sponsorlu" are selected together).
--      Documents are now defined in a single list (document_types); which document is required in which combination
--      and with which rule (required / conditional / optional) is in the document_rules + document_rule_items tables.
--      A rule applies if ALL types IN THE RULE are selected in the application (a rule with an empty type list applies to
--      every application); if a sponsor status is given, only for that sponsor status. If the same document comes from several
--      rules the strictest rule wins (required > conditional > optional). Existing groups are converted one-to-one to rules:
--      the list the customer sees does not change after this file.
--   2. The lists in Settings (cities, appointment locations, documents, ZIP folders) can be reordered by dragging:
--      sort_order is added to appointment locations (the others already had it).
--   3. A customer can make just one appointment preference if they want (at least 1, at most 3 days).
--
-- DATA: no row is deleted. The application_type / sponsor_status / requirement /
-- allow_not_applicable columns in document_types are copied into the rules and are not read after this file (kept for backward compatibility).
-- If run a second time it stops with an "already exists" error on the first statement.

alter table public.appointment_locations add column sort_order integer not null default 0;

-- ---------------------------------------------------------------------------
-- 1. Document rules
-- ---------------------------------------------------------------------------

create table public.document_rules (
  id uuid primary key default gen_random_uuid(),
  -- Empty list: every application (shared documents).
  application_types text[] not null default '{}' check (
    application_types <@ array['general_employee', 'self_employed', 'retired', 'student', 'uk_family_visit', 'sponsored']::text[]
  ),
  sponsor_status text check (sponsor_status in ('employee', 'retired', 'business_owner')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sponsor_status is null or 'sponsored' = any (application_types))
);
-- A single rule per combination (the type list is sorted and de-duplicated in the trigger).
create unique index document_rules_combination_idx on public.document_rules (application_types, coalesce(sponsor_status, ''));

create table public.document_rule_items (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.document_rules (id) on delete cascade,
  document_type_id text not null references public.document_types (id) on delete cascade,
  requirement text not null default 'required' check (requirement in ('required', 'conditional', 'optional')),
  created_at timestamptz not null default now(),
  unique (rule_id, document_type_id)
);
create index document_rule_items_document_idx on public.document_rule_items (document_type_id);

-- The type list is sorted and de-duplicated (so the same combination cannot be entered twice in a different order).
create function private.document_rules_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.application_types := coalesce((select array_agg(distinct t order by t) from unnest(new.application_types) as t), '{}'::text[]);
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.document_rules_normalize() from public, anon, authenticated;

create trigger document_rules_normalize before insert or update on public.document_rules
  for each row execute function private.document_rules_normalize();
create trigger document_rules_audit after insert or update or delete on public.document_rules
  for each row execute function private.config_audit();
create trigger document_rule_items_audit after insert or update or delete on public.document_rule_items
  for each row execute function private.config_audit();

alter table public.document_rules enable row level security;
alter table public.document_rule_items enable row level security;
revoke all on public.document_rules, public.document_rule_items from anon, authenticated;
grant all on public.document_rules, public.document_rule_items to service_role;
grant select, insert, update, delete on public.document_rules, public.document_rule_items to authenticated;

-- Only staff see and manage them; the customer's document list comes from the sync function (SECURITY DEFINER).
create policy document_rules_staff_select on public.document_rules for select to authenticated using (private.is_staff());
create policy document_rules_staff_insert on public.document_rules for insert to authenticated with check (private.is_staff());
create policy document_rules_staff_update on public.document_rules for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy document_rules_staff_delete on public.document_rules for delete to authenticated using (private.is_staff());
create policy document_rule_items_staff_select on public.document_rule_items for select to authenticated using (private.is_staff());
create policy document_rule_items_staff_insert on public.document_rule_items for insert to authenticated with check (private.is_staff());
create policy document_rule_items_staff_update on public.document_rule_items for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy document_rule_items_staff_delete on public.document_rule_items for delete to authenticated using (private.is_staff());

-- Existing groups are converted to rules: shared documents (no type) → a rule with an empty list; each type → a single-type rule;
-- sponsored + sponsor status → the rule for that status.
insert into public.document_rules (application_types, sponsor_status)
select distinct
  case when dt.application_type is null then '{}'::text[] else array[dt.application_type] end,
  dt.sponsor_status
from public.document_types dt;

insert into public.document_rule_items (rule_id, document_type_id, requirement)
select r.id, dt.id, dt.requirement
from public.document_types dt
join public.document_rules r
  on r.application_types = (case when dt.application_type is null then '{}'::text[] else array[dt.application_type] end)
 and coalesce(r.sponsor_status, '') = coalesce(dt.sponsor_status, '');

update public.document_rules r
  set sort_order = o.n
  from (
    select id, row_number() over (order by cardinality(application_types), application_types, sponsor_status nulls first) as n
    from public.document_rules
  ) o
  where o.id = r.id;

-- Documents required for an application according to the rules: document, strictest rule and maximum number of files.
create function private.application_required_documents(p_application_id uuid)
returns table (document_type_id text, requirement text, max_files integer)
language sql
stable
security definer
set search_path = ''
as $$
  select dt.id,
         (array['optional', 'conditional', 'required'])[max(case i.requirement when 'required' then 3 when 'conditional' then 2 else 1 end)],
         dt.max_files
  from public.applications a
  join public.document_rules r
    on r.application_types <@ a.application_types
   and (r.sponsor_status is null or r.sponsor_status = a.sponsor_status)
  join public.document_rule_items i on i.rule_id = r.id
  join public.document_types dt on dt.id = i.document_type_id
  where a.id = p_application_id
    and dt.is_active
    and (not dt.minors_only or private.applicant_is_minor(a.id))
  group by dt.id, dt.max_files;
$$;
revoke all on function private.application_required_documents(uuid) from public, anon, authenticated;

-- Syncs the document list with the rules (replaces the definition in migration 7). Permission and slot rules are the same.
create or replace function public.sync_application_documents(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_uid uuid := (select auth.uid());
begin
  select * into v_app from public.applications where id = p_application_id;
  -- CAUTION: Because this function is SECURITY DEFINER, current_user inside it is the function owner;
  -- private.is_privileged() ALWAYS returns true here and CANNOT be used for permission checks.
  -- Identity is determined with auth.uid(). EXECUTE is only granted to authenticated (which always carries a uid)
  -- and service_role, so an empty uid means the request came from the service role.
  if v_uid is not null
     and not (private.is_staff() or (found and v_app.customer_id = v_uid and v_app.status = 'draft')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.application_documents (application_id, document_type_id, requirement, allow_not_applicable, max_files)
  select v_app.id, rd.document_type_id, rd.requirement, rd.requirement = 'conditional', rd.max_files
  from private.application_required_documents(v_app.id) rd
  on conflict (application_id, document_type_id) do update
    set requirement = excluded.requirement,
        allow_not_applicable = excluded.allow_not_applicable,
        max_files = excluded.max_files,
        out_of_scope = false,
        -- A document that is now required cannot stay "not applicable".
        not_applicable = case when excluded.requirement = 'required' or not excluded.allow_not_applicable
                              then false else public.application_documents.not_applicable end;

  -- Slots no longer required: deleted if there is no file; if there is a file they are flagged so it is not lost.
  delete from public.application_documents d
  where d.application_id = v_app.id
    and d.document_type_id is not null
    and not exists (select 1 from public.application_files f where f.application_document_id = d.id)
    and d.document_type_id not in (select rd.document_type_id from private.application_required_documents(v_app.id) rd);

  update public.application_documents d
    set out_of_scope = true, requirement = 'optional', not_applicable = false
  where d.application_id = v_app.id
    and d.document_type_id is not null
    and d.document_type_id not in (select rd.document_type_id from private.application_required_documents(v_app.id) rd);
end;
$$;

-- Saves a rule (combination + its documents) in one go; staff only (RLS checks too). If no rule id is given
-- a new rule is created. Documents: [{"document_type_id": "...", "requirement": "required"}, ...].
-- Runs with the caller's permissions (SECURITY INVOKER); the save either happens completely or not at all.
create function public.save_document_rule(p_id uuid, p_application_types text[], p_sponsor_status text, p_items jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items_invalid' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.document_rules (application_types, sponsor_status)
    values (coalesce(p_application_types, '{}'), p_sponsor_status)
    returning id into v_id;
  else
    update public.document_rules
      set application_types = coalesce(p_application_types, '{}'), sponsor_status = p_sponsor_status
      where id = v_id;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.document_rule_items where rule_id = v_id;
  insert into public.document_rule_items (rule_id, document_type_id, requirement)
  select v_id, item ->> 'document_type_id', coalesce(item ->> 'requirement', 'required')
  from jsonb_array_elements(p_items) as t (item);
  return v_id;
end;
$$;
revoke all on function public.save_document_rule(uuid, text[], text, jsonb) from public, anon;
grant execute on function public.save_document_rule(uuid, text[], text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Appointment preference: at least 1, at most 3 days (replaces the definition in migration 10)
-- ---------------------------------------------------------------------------
create or replace function public.svc_set_appointment_preferences(
  p_actor_id uuid,
  p_application_id uuid,
  p_preferences jsonb,
  p_outside_window boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_count integer;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (v_app.status = 'draft' or v_app.appointment_status = 'preferences_requested') then
    raise exception 'preferences_not_editable' using errcode = 'P0001';
  end if;
  if p_outside_window is null or jsonb_typeof(p_preferences) <> 'array' then
    raise exception 'preferences_invalid' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_preferences);
  -- 1–3 days for both the normal preference and "dates don't suit me".
  if v_count < 1 or v_count > 3 then
    raise exception 'one_to_three_preferences_required' using errcode = 'P0001';
  end if;
  -- Each day is picked once in the calendar.
  if (select count(distinct item ->> 'date') from jsonb_array_elements(p_preferences) as t (item)) <> v_count then
    raise exception 'duplicate_preference_date' using errcode = 'P0001';
  end if;

  delete from public.appointment_preferences where application_id = p_application_id;
  insert into public.appointment_preferences (application_id, rank, preferred_date, slot)
  select p_application_id, ordinality::smallint, (item ->> 'date')::date, item ->> 'slot'
  from jsonb_array_elements(p_preferences) with ordinality as t (item, ordinality);

  update public.applications
    set appointment_outside_window = p_outside_window,
        appointment_status = case when v_app.appointment_status = 'preferences_requested' then 'preferences_submitted' else appointment_status end
    where id = p_application_id;
  perform private.write_audit(p_actor_id, 'appointment.preferences_saved', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('outside_window', p_outside_window));
end;
$$;

-- Submission: at least one preference (replaces the definition in migration 9; only the preference count rule changed).
create or replace function public.svc_submit_application(
  p_actor_id uuid,
  p_application_id uuid,
  p_fee_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_fee_count integer;
  v_preference_count integer;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_app.status <> 'draft' then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;
  if p_fee_items is null or jsonb_typeof(p_fee_items) <> 'array' then
    raise exception 'fees_invalid' using errcode = '22023';
  end if;
  select count(*) into v_preference_count from public.appointment_preferences where application_id = p_application_id;
  if v_preference_count not between 1 and 3 then
    raise exception 'appointment_preferences_missing' using errcode = 'P0001';
  end if;

  v_fee_count := jsonb_array_length(p_fee_items);

  delete from public.application_fee_items where application_id = p_application_id;
  insert into public.application_fee_items (application_id, label, kind, amount, currency, sort_order)
  select p_application_id, item ->> 'label', item ->> 'kind', (item ->> 'amount')::numeric, item ->> 'currency', ordinality::int
  from jsonb_array_elements(p_fee_items) with ordinality as t (item, ordinality);

  update public.applications
    set status = 'submitted',
        form_locked = true,
        payment_status = 'awaiting_payment',
        appointment_status = 'preferences_submitted',
        submitted_at = now(),
        fees_snapshot_at = case when v_fee_count > 0 then now() else null end
    where id = p_application_id;

  perform private.write_audit(p_actor_id, 'application.submitted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('fee_item_count', v_fee_count));
end;
$$;

-- >>> 20261021000100_staff_delete.sql
-- =============================================================================
-- Migration 21: permanently deleting a staff account
-- =============================================================================
-- an admin can delete a staff member completely from the staff list (with a serious warning).
--
-- Deletion takes two steps: (1) svc_delete_staff in this file disables the person's access and preserves their name in past records;
-- (2) the app deletes the authentication account with the Supabase admin API (auth.users → profiles is deleted; fields linked to
-- this person are cleared by the "on delete set null" rule from the first migration).
--
-- The person's audit history, internal notes and messages they wrote to customers are NOT DELETED. In the audit log and internal
-- notes their name keeps showing with a "(silinmiş personel)" (deleted staff) suffix (actor_label / author_label; only staff read
-- them). Messages get no name label: customers read message rows too; in the admin panel the author shows as "Silinmiş personel".
--
-- DATA: no row is deleted or changed; only two columns are added. If run a second time it stops with an
-- "already exists" error on the first statement.

alter table public.audit_log add column actor_label text check (char_length(actor_label) <= 200);
alter table public.staff_notes add column author_label text check (char_length(author_label) <= 200);

-- Staff cannot write the name label when adding a note (only svc_delete_staff writes it during deletion).
drop policy staff_notes_staff_insert on public.staff_notes;
create policy staff_notes_staff_insert on public.staff_notes
  for insert to authenticated
  with check (private.is_staff() and author_id = (select auth.uid()) and author_label is null);

-- Prepares a staff member for deletion: disables access and admin rights, preserves their name in past records, records the action.
-- Called ONLY by the service role; the server calls it after verifying the actor's identity. The actor must be an active
-- admin; nobody can delete themselves; only staff accounts are deleted (a customer account cannot be deleted this way).
create function public.svc_delete_staff(p_actor_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_label text;
begin
  if p_actor_id is null
     or not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_actor_id = p_user_id then
    raise exception 'cannot_change_own_access' using errcode = 'P0001';
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found or v_target.role <> 'staff' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_label := left(
    coalesce(nullif(trim(concat_ws(' ', v_target.first_name, v_target.last_name)), ''), v_target.email, 'Personel') || ' (silinmiş personel)',
    200
  );

  perform set_config('app.actor_id', p_actor_id::text, true);
  -- Even if the identity account cannot be deleted, the person no longer holds staff rights.
  update public.profiles set is_active = false, is_admin = false where id = p_user_id;

  update public.audit_log set actor_label = v_label where actor_id = p_user_id;
  update public.staff_notes set author_label = v_label where author_id = p_user_id;

  perform private.write_audit(p_actor_id, 'staff.deleted', null, 'profile', p_user_id::text, jsonb_build_object('name', v_label));
end;
$$;

revoke all on function public.svc_delete_staff(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_delete_staff(uuid, uuid) to service_role;

-- >>> 20261023000100_form_edit_note_optional.sql
-- =============================================================================
-- Migration 22: the note on a form edit request is optional
-- =============================================================================
-- the customer should not have to write anything when asking to change their submitted
-- form. svc_request_form_edit in migration 17 required the note to be 1–1000 characters; now the note can be left
-- empty (stored as NULL if empty) and is at most 1000 characters. All other rules are the same.
-- (The consultant refusing a request without a reason is app-only; it requires no database change.)
--
-- DATA: no row is deleted or changed; only the function is redefined. It can be run a second time.

create or replace function public.svc_request_form_edit(p_actor_id uuid, p_application_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Changing the form after the appointment makes no sense; it cannot be requested for cancelled or concluded applications either.
  if v_app.status not in ('submitted', 'in_review', 'awaiting_customer', 'documents_complete') then
    raise exception 'form_edit_request_not_allowed' using errcode = 'P0001';
  end if;
  if not v_app.form_locked then
    raise exception 'form_already_open' using errcode = 'P0001';
  end if;
  if v_app.form_edit_requested_at is not null then
    raise exception 'form_edit_already_requested' using errcode = 'P0001';
  end if;
  -- The note is optional (migration 22); only its length is limited.
  if char_length(v_note) > 1000 then
    raise exception 'form_edit_note_invalid' using errcode = '22023';
  end if;

  update public.applications
    set form_edit_requested_at = now(), form_edit_request_note = nullif(v_note, '')
    where id = p_application_id;
  perform private.write_audit(p_actor_id, 'form.edit_requested', p_application_id, 'application', p_application_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.svc_request_form_edit(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_request_form_edit(uuid, uuid, text) to service_role;

-- >>> 20261023000200_staff_recovery_code.sql
-- =============================================================================
-- Migration 23: recovery code for two-factor authentication
-- =============================================================================
-- a staff member who lost their phone (authenticator app) can set up authentication again themselves without
-- waiting for another admin. For this every staff member has a single recovery code: 20 characters,
-- mixed letters and digits (e.g. K7Q4-9MZD-X2PH-RT6W-8BNC). The code is shown on screen only once, when it is created;
-- the database stores its SHA-256 digest, never the code itself. A used code is deleted; the person creates a new code
-- after setting up authentication again. The recovery code can only be used in a session signed in with the password
-- (password + recovery code = two separate factors), so it does not weaken the protection of two-factor authentication.
--
-- The table is in the private schema (not exposed to the database API) and no session can read/write it directly; all
-- operations go through the three functions below, with the service role only. The app calls them after verifying the
-- person's identity; the functions re-check that the person is active staff. After 5 wrong attempts in a row the person
-- must wait 15 minutes. Creation, use and wrong attempts are written to the audit log (never the code or its digest).
--
-- DATA: no row is deleted or changed; only a table and three functions are added. If run a second time
-- it stops with an "already exists" error on the first statement.

create table private.staff_recovery_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table private.staff_recovery_codes enable row level security;
revoke all on private.staff_recovery_codes from public, anon, authenticated;

-- Creates or renews the recovery code (the old one becomes invalid). Active staff only.
create function public.svc_set_staff_recovery_code(p_user_id uuid, p_code_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'staff' and p.is_active) then
    raise exception 'not_staff' using errcode = '42501';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_code_hash' using errcode = '22023';
  end if;
  insert into private.staff_recovery_codes (user_id, code_hash, created_at)
    values (p_user_id, p_code_hash, now())
    on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = excluded.created_at;
  perform private.write_audit(p_user_id, 'staff.recovery_code_created', null, 'profile', p_user_id::text, '{}'::jsonb);
end;
$$;

-- Tries the recovery code. If correct the code is deleted and true is returned (the app then deletes the authenticator factor);
-- if wrong the attempt is recorded and false is returned. With 5 wrong attempts in the last 15 minutes it is not tried at all.
create function public.svc_use_staff_recovery_code(p_user_id uuid, p_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failures integer;
  v_deleted integer;
begin
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'staff' and p.is_active) then
    raise exception 'not_staff' using errcode = '42501';
  end if;
  select count(*) into v_failures from public.audit_log
    where actor_id = p_user_id and action = 'staff.recovery_code_failed' and created_at > now() - interval '15 minutes';
  if v_failures >= 5 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;

  delete from private.staff_recovery_codes
    where user_id = p_user_id and code_hash = coalesce(p_code_hash, '');
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    perform private.write_audit(p_user_id, 'staff.recovery_code_failed', null, 'profile', p_user_id::text, '{}'::jsonb);
    return false;
  end if;
  perform private.write_audit(p_user_id, 'staff.recovery_code_used', null, 'profile', p_user_id::text, '{}'::jsonb);
  return true;
end;
$$;

-- When the person's recovery code was created (NULL if none). The code itself cannot be read in any way.
create function public.svc_staff_recovery_code_created_at(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select created_at from private.staff_recovery_codes where user_id = p_user_id;
$$;

revoke all on function public.svc_set_staff_recovery_code(uuid, text) from public, anon, authenticated;
revoke all on function public.svc_use_staff_recovery_code(uuid, text) from public, anon, authenticated;
revoke all on function public.svc_staff_recovery_code_created_at(uuid) from public, anon, authenticated;
grant execute on function public.svc_set_staff_recovery_code(uuid, text) to service_role;
grant execute on function public.svc_use_staff_recovery_code(uuid, text) to service_role;
grant execute on function public.svc_staff_recovery_code_created_at(uuid) to service_role;

-- >>> 20261023000300_application_terms.sql
-- =============================================================================
-- Migration 24: acceptance of the application terms of service
-- =============================================================================
-- before submitting their application the customer reads and accepts the "Başvuru Hizmet Şartları ve Onay
-- Beyanı" (application terms of service and declaration of consent, /application-terms). The acceptance is recorded,
-- linked to the application, with the text's version and time; a draft whose terms were not accepted cannot be submitted (the database checks too).
--
-- The record is only written with svc_accept_application_terms through the service role (the app calls it after verifying
-- the customer's identity and the confirmations they ticked); the function re-checks the application's owner and that it is a draft.
-- The customer can read their own record, staff all records; no session can write. When an application is deleted its record is deleted too.
--
-- DATA: no row is deleted or changed; a table, a function and a trigger are added. Previously submitted
-- applications are not affected (the check only happens on the transition from draft to submitted). If run a second time
-- it stops with an "already exists" error on the first statement.

create table public.application_terms_acceptances (
  application_id uuid primary key references public.applications (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  terms_version text not null check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default now()
);
alter table public.application_terms_acceptances enable row level security;
revoke all on public.application_terms_acceptances from public, anon, authenticated;
grant select on public.application_terms_acceptances to authenticated;
create policy application_terms_select on public.application_terms_acceptances
  for select to authenticated
  using (private.owns_application(application_id) or private.is_staff());

-- Records that the customer accepted the terms (right before submission). Only the application's owner and only for a draft.
create function public.svc_accept_application_terms(p_actor_id uuid, p_application_id uuid, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_app.status <> 'draft' then
    raise exception 'application_not_editable' using errcode = '42501';
  end if;
  if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid_terms_version' using errcode = '22023';
  end if;

  insert into public.application_terms_acceptances (application_id, customer_id, terms_version, accepted_at)
    values (p_application_id, p_actor_id, p_version, now())
    on conflict (application_id) do update
      set customer_id = excluded.customer_id, terms_version = excluded.terms_version, accepted_at = excluded.accepted_at;
  perform private.write_audit(p_actor_id, 'application.terms_accepted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('version', p_version));
end;
$$;
revoke all on function public.svc_accept_application_terms(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_accept_application_terms(uuid, uuid, text) to service_role;

-- The terms must have been accepted for the transition from draft to submitted.
create function private.require_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status <> 'draft'
     and not exists (select 1 from public.application_terms_acceptances t where t.application_id = new.id) then
    raise exception 'terms_not_accepted' using errcode = 'P0001',
      hint = 'Başvuru hizmet şartları kabul edilmeden başvuru gönderilemez.';
  end if;
  return new;
end;
$$;
revoke all on function private.require_terms_acceptance() from public, anon, authenticated;

create trigger applications_require_terms before update of status on public.applications
  for each row execute function private.require_terms_acceptance();

-- >>> 20261023000400_appointment_letter.sql
-- =============================================================================
-- Migration 25: appointment letter
-- =============================================================================
-- when sending the appointment date the consultant can also upload the appointment letter;
-- the customer can view and download it from the appointment card.
--
-- The letter is stored as a separate file type in the application's private folder ("appointment_letter"). Sessions cannot
-- write file records (only the service role, after the app verifies the staff member's identity); the customer reads the files
-- of their own application (existing policy). When a new letter is uploaded the app deletes the old one.
--
-- DATA: no row is deleted or changed; only the file type constraint is widened. It can be run a second time.

alter table public.application_files drop constraint application_files_kind_check;
alter table public.application_files add constraint application_files_kind_check
  check (kind in ('document', 'payment_receipt', 'staff_attachment', 'visa_result', 'appointment_letter'));

-- >>> 20261026000100_optional_documents_extra_uploads.sql
-- =============================================================================
-- Migration 26: removing the "Koşullu" (conditional) document rule, and extra documents after submission
-- =============================================================================
-- Scope:
--   1. A document rule is only "Zorunlu" (required) or "İsteğe bağlı" (optional); "Koşullu" and the related "Bu belge benim
--      için geçerli değil" (this document does not apply to me) declaration go away. All conditional documents (rules in
--      Settings and documents in applications) become optional.
--   2. After submitting their application the customer can send extra documents without asking the consultant. They cannot
--      change the documents uploaded at submission; extra documents are a separate file type ("extra_document"). The maximum
--      number of extra documents comes from Settings → General ("documents.extra_max", initially 10; 0 disables extra documents).
--
-- DATA: no row is deleted. What changes: conditional rules/documents become optional (the "not applicable" permission is closed;
-- a "not applicable" declaration the customer made earlier stays in the record). If a conditional document was awaiting a
-- re-upload it is no longer awaited since it is now optional; that application's status updates by itself according to its rule
-- ("Otomatik" in the audit log). "documents.extra_max" (10) is added to the settings.
--
-- WITH LIVE CUSTOMERS:
-- if a customer picked an application type on a draft while the file was running, the document list could be written with the old
-- ("conditional") rules. So the file runs inside a single transaction and makes writes to the document tables wait until it
-- finishes (reads continue; a few seconds). If there is an error nothing changes. The file can be run a second time; the result is the same.

begin;

lock table public.document_rule_items, public.document_types, public.application_documents, public.application_files
  in share row exclusive mode;

-- Extra document limit (used in section 2).
create or replace function private.extra_document_limit()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- If the setting is not a number (left empty or missing) the default of 10 applies.
  select coalesce(
    (select case when jsonb_typeof(s.value) = 'number' then greatest(0, (s.value #>> '{}')::numeric::integer) end
     from public.settings s where s.key = 'documents.extra_max'),
    10
  );
$$;
revoke all on function private.extra_document_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Conditional → optional
-- ---------------------------------------------------------------------------

update public.document_rule_items set requirement = 'optional' where requirement not in ('required', 'optional');
update public.document_types set requirement = 'optional', allow_not_applicable = false where requirement not in ('required', 'optional');
update public.document_types set allow_not_applicable = false where allow_not_applicable;
update public.application_documents set requirement = 'optional' where requirement not in ('required', 'optional');
update public.application_documents set allow_not_applicable = false where allow_not_applicable;

-- If a record that could not be converted remains, stop with a descriptive error (nothing changes).
do $$
declare
  v_left text;
begin
  select string_agg(format('%s / %s: %s', t.tablo, t.requirement, t.n), ', ') into v_left
  from (
    select 'document_rule_items' as tablo, requirement, count(*) as n from public.document_rule_items
      where requirement not in ('required', 'optional') group by requirement
    union all
    select 'document_types', requirement, count(*) from public.document_types
      where requirement not in ('required', 'optional') group by requirement
    union all
    select 'application_documents', requirement, count(*) from public.application_documents
      where requirement not in ('required', 'optional') group by requirement
  ) t;
  if v_left is not null then
    raise exception 'Dönüştürülemeyen belge kaydı kaldı (%; çalıştıran rol: %). Hiçbir şey değişmedi; bu mesajı geliştiriciye iletin.',
      v_left, current_user;
  end if;
end;
$$;

alter table public.document_rule_items drop constraint if exists document_rule_items_requirement_check;
alter table public.document_rule_items add constraint document_rule_items_requirement_check check (requirement in ('required', 'optional'));
alter table public.document_types drop constraint if exists document_types_requirement_check;
alter table public.document_types add constraint document_types_requirement_check check (requirement in ('required', 'optional'));
alter table public.application_documents drop constraint if exists application_documents_requirement_check;
alter table public.application_documents add constraint application_documents_requirement_check check (requirement in ('required', 'optional'));
-- The "not applicable" permission can no longer be enabled on any document (the document_types_not_applicable_conditional_only
-- constraint on document_types gives the same result: since a document cannot be conditional the permission is always off).
alter table public.application_documents drop constraint if exists application_documents_no_not_applicable;
alter table public.application_documents add constraint application_documents_no_not_applicable check (not allow_not_applicable);

-- Documents required for an application according to the rules: the strictest rule wins (required > optional).
create or replace function private.application_required_documents(p_application_id uuid)
returns table (document_type_id text, requirement text, max_files integer)
language sql
stable
security definer
set search_path = ''
as $$
  select dt.id,
         case when bool_or(i.requirement = 'required') then 'required' else 'optional' end,
         dt.max_files
  from public.applications a
  join public.document_rules r
    on r.application_types <@ a.application_types
   and (r.sponsor_status is null or r.sponsor_status = a.sponsor_status)
  join public.document_rule_items i on i.rule_id = r.id
  join public.document_types dt on dt.id = i.document_type_id
  where a.id = p_application_id
    and dt.is_active
    and (not dt.minors_only or private.applicant_is_minor(a.id))
  group by dt.id, dt.max_files;
$$;
revoke all on function private.application_required_documents(uuid) from public, anon, authenticated;

-- Syncs the document list with the rules (replaces the definition in migration 20; the "not applicable" permission is no longer granted).
create or replace function public.sync_application_documents(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_uid uuid := (select auth.uid());
begin
  select * into v_app from public.applications where id = p_application_id;
  -- CAUTION: Because this function is SECURITY DEFINER, current_user inside it is the function owner;
  -- private.is_privileged() ALWAYS returns true here and CANNOT be used for permission checks.
  -- Identity is determined with auth.uid(). EXECUTE is only granted to authenticated (which always carries a uid)
  -- and service_role, so an empty uid means the request came from the service role.
  if v_uid is not null
     and not (private.is_staff() or (found and v_app.customer_id = v_uid and v_app.status = 'draft')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.application_documents (application_id, document_type_id, requirement, max_files)
  select v_app.id, rd.document_type_id, rd.requirement, rd.max_files
  from private.application_required_documents(v_app.id) rd
  on conflict (application_id, document_type_id) do update
    set requirement = excluded.requirement,
        max_files = excluded.max_files,
        out_of_scope = false,
        -- A required document cannot stay "not applicable".
        not_applicable = case when excluded.requirement = 'required' then false else public.application_documents.not_applicable end;

  -- Slots no longer required: deleted if there is no file; if there is a file they are flagged so it is not lost.
  delete from public.application_documents d
  where d.application_id = v_app.id
    and d.document_type_id is not null
    and not exists (select 1 from public.application_files f where f.application_document_id = d.id)
    and d.document_type_id not in (select rd.document_type_id from private.application_required_documents(v_app.id) rd);

  update public.application_documents d
    set out_of_scope = true, requirement = 'optional', not_applicable = false
  where d.application_id = v_app.id
    and d.document_type_id is not null
    and d.document_type_id not in (select rd.document_type_id from private.application_required_documents(v_app.id) rd);
end;
$$;

-- The "Bu belge benim için geçerli değil" declaration is gone; the function that recorded it is dropped too.
drop function if exists public.svc_set_document_not_applicable(uuid, uuid, boolean, text);

-- ---------------------------------------------------------------------------
-- 2. Extra documents after submission
-- ---------------------------------------------------------------------------

alter table public.application_files drop constraint if exists application_files_kind_check;
alter table public.application_files add constraint application_files_kind_check
  check (kind in ('document', 'payment_receipt', 'staff_attachment', 'visa_result', 'appointment_letter', 'extra_document'));

insert into public.settings (key, value, visibility) values ('documents.extra_max', '10', 'customer')
on conflict (key) do nothing;

-- Extra documents are only added to a submitted, ongoing application; the number of verified (ready) extra documents cannot
-- exceed the limit in the settings. The app checks the same rule (src/features/documents/upload-authorization.ts); this trigger is the
-- last line of defense. The application row is locked: two uploads at the same time cannot exceed the limit together.
create or replace function private.application_files_extra_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_count integer;
begin
  if new.kind <> 'extra_document' then
    return new;
  end if;
  select a.status into v_status from public.applications a where a.id = new.application_id for update;
  if v_status is null or v_status not in ('submitted', 'in_review', 'awaiting_customer', 'documents_complete', 'awaiting_result') then
    raise exception 'extra_document_not_allowed' using errcode = 'P0001';
  end if;
  if new.status = 'ready' and (tg_op = 'INSERT' or old.status is distinct from 'ready') then
    select count(*) into v_count from public.application_files f
    where f.application_id = new.application_id and f.kind = 'extra_document' and f.status = 'ready' and f.id <> new.id;
    if v_count >= private.extra_document_limit() then
      raise exception 'extra_document_limit' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.application_files_extra_guard() from public, anon, authenticated;

drop trigger if exists application_files_extra_guard on public.application_files;
create trigger application_files_extra_guard
  before insert or update on public.application_files
  for each row execute function private.application_files_extra_guard();

commit;

-- >>> 20261027000100_staff_delete_application.sql
-- =============================================================================
-- Migration 27: an admin permanently deleting an application
-- =============================================================================
-- test applications created by consultants, and any application when needed, can be deleted
-- from the admin panel. Deletion is only for active ADMIN staff (like staff management);
-- for a submitted application the app additionally asks for the application number to be typed.
--
-- Deleted: the application and every record attached to it (form answers, documents and file records, appointment preferences,
-- messages, internal notes, tasks, notifications, terms acceptance). The storage paths of the files are returned; the app deletes
-- them from storage. The customer's account is not deleted. "application.deleted" (application number, status, who deleted) is
-- written to the audit log; once the application is deleted the entry's application link is cleared and the number remains.
--
-- DATA: this file changes or deletes no rows; it only adds the function. It can be run a second time.

create or replace function public.svc_delete_application(p_actor_id uuid, p_application_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  -- CAUTION: inside SECURITY DEFINER private.is_privileged() always returns true; permission is checked against the profile
  -- with the actor's identity (the app calls it after verifying the identity from the session; only the service role can call it).
  if p_actor_id is null
     or not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return query select f.storage_path from public.application_files f where f.application_id = p_application_id;

  -- Written before the record is deleted; once the application is deleted the entry's application link is cleared and the application number remains.
  perform private.write_audit(p_actor_id, 'application.deleted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('reference_code', v_app.reference_code, 'status', v_app.status));
  delete from public.applications where id = p_application_id;
end;
$$;

revoke all on function public.svc_delete_application(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_delete_application(uuid, uuid) to service_role;
