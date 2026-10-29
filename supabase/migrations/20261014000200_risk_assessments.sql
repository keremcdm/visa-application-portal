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
