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
