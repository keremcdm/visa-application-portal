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
