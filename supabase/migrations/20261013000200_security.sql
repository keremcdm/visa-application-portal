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
