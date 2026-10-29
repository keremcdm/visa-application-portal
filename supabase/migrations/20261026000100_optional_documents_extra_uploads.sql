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
