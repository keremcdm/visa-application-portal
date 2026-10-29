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
