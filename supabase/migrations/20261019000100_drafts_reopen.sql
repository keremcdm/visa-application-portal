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
