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
