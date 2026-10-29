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
