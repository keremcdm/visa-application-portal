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
