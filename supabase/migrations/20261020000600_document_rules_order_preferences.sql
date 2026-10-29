-- =============================================================================
-- Migration 20: document rules by application type combination, ordering, a single appointment preference
-- =============================================================================
-- Scope:
--   1. Which documents are required in which application is set in Settings, by application type COMBINATIONS
--      (e.g. these documents for "Öğrenci", and these in addition when "Öğrenci + Sponsorlu" are selected together).
--      Documents are now defined in a single list (document_types); which document is required in which combination
--      and with which rule (required / conditional / optional) is in the document_rules + document_rule_items tables.
--      A rule applies if ALL types IN THE RULE are selected in the application (a rule with an empty type list applies to
--      every application); if a sponsor status is given, only for that sponsor status. If the same document comes from several
--      rules the strictest rule wins (required > conditional > optional). Existing groups are converted one-to-one to rules:
--      the list the customer sees does not change after this file.
--   2. The lists in Settings (cities, appointment locations, documents, ZIP folders) can be reordered by dragging:
--      sort_order is added to appointment locations (the others already had it).
--   3. A customer can make just one appointment preference if they want (at least 1, at most 3 days).
--
-- DATA: no row is deleted. The application_type / sponsor_status / requirement /
-- allow_not_applicable columns in document_types are copied into the rules and are not read after this file (kept for backward compatibility).
-- If run a second time it stops with an "already exists" error on the first statement.

alter table public.appointment_locations add column sort_order integer not null default 0;

-- ---------------------------------------------------------------------------
-- 1. Document rules
-- ---------------------------------------------------------------------------

create table public.document_rules (
  id uuid primary key default gen_random_uuid(),
  -- Empty list: every application (shared documents).
  application_types text[] not null default '{}' check (
    application_types <@ array['general_employee', 'self_employed', 'retired', 'student', 'uk_family_visit', 'sponsored']::text[]
  ),
  sponsor_status text check (sponsor_status in ('employee', 'retired', 'business_owner')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sponsor_status is null or 'sponsored' = any (application_types))
);
-- A single rule per combination (the type list is sorted and de-duplicated in the trigger).
create unique index document_rules_combination_idx on public.document_rules (application_types, coalesce(sponsor_status, ''));

create table public.document_rule_items (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.document_rules (id) on delete cascade,
  document_type_id text not null references public.document_types (id) on delete cascade,
  requirement text not null default 'required' check (requirement in ('required', 'conditional', 'optional')),
  created_at timestamptz not null default now(),
  unique (rule_id, document_type_id)
);
create index document_rule_items_document_idx on public.document_rule_items (document_type_id);

-- The type list is sorted and de-duplicated (so the same combination cannot be entered twice in a different order).
create function private.document_rules_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.application_types := coalesce((select array_agg(distinct t order by t) from unnest(new.application_types) as t), '{}'::text[]);
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.document_rules_normalize() from public, anon, authenticated;

create trigger document_rules_normalize before insert or update on public.document_rules
  for each row execute function private.document_rules_normalize();
create trigger document_rules_audit after insert or update or delete on public.document_rules
  for each row execute function private.config_audit();
create trigger document_rule_items_audit after insert or update or delete on public.document_rule_items
  for each row execute function private.config_audit();

alter table public.document_rules enable row level security;
alter table public.document_rule_items enable row level security;
revoke all on public.document_rules, public.document_rule_items from anon, authenticated;
grant all on public.document_rules, public.document_rule_items to service_role;
grant select, insert, update, delete on public.document_rules, public.document_rule_items to authenticated;

-- Only staff see and manage them; the customer's document list comes from the sync function (SECURITY DEFINER).
create policy document_rules_staff_select on public.document_rules for select to authenticated using (private.is_staff());
create policy document_rules_staff_insert on public.document_rules for insert to authenticated with check (private.is_staff());
create policy document_rules_staff_update on public.document_rules for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy document_rules_staff_delete on public.document_rules for delete to authenticated using (private.is_staff());
create policy document_rule_items_staff_select on public.document_rule_items for select to authenticated using (private.is_staff());
create policy document_rule_items_staff_insert on public.document_rule_items for insert to authenticated with check (private.is_staff());
create policy document_rule_items_staff_update on public.document_rule_items for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy document_rule_items_staff_delete on public.document_rule_items for delete to authenticated using (private.is_staff());

-- Existing groups are converted to rules: shared documents (no type) → a rule with an empty list; each type → a single-type rule;
-- sponsored + sponsor status → the rule for that status.
insert into public.document_rules (application_types, sponsor_status)
select distinct
  case when dt.application_type is null then '{}'::text[] else array[dt.application_type] end,
  dt.sponsor_status
from public.document_types dt;

insert into public.document_rule_items (rule_id, document_type_id, requirement)
select r.id, dt.id, dt.requirement
from public.document_types dt
join public.document_rules r
  on r.application_types = (case when dt.application_type is null then '{}'::text[] else array[dt.application_type] end)
 and coalesce(r.sponsor_status, '') = coalesce(dt.sponsor_status, '');

update public.document_rules r
  set sort_order = o.n
  from (
    select id, row_number() over (order by cardinality(application_types), application_types, sponsor_status nulls first) as n
    from public.document_rules
  ) o
  where o.id = r.id;

-- Documents required for an application according to the rules: document, strictest rule and maximum number of files.
create function private.application_required_documents(p_application_id uuid)
returns table (document_type_id text, requirement text, max_files integer)
language sql
stable
security definer
set search_path = ''
as $$
  select dt.id,
         (array['optional', 'conditional', 'required'])[max(case i.requirement when 'required' then 3 when 'conditional' then 2 else 1 end)],
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

-- Syncs the document list with the rules (replaces the definition in migration 7). Permission and slot rules are the same.
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
  select v_app.id, rd.document_type_id, rd.requirement, rd.requirement = 'conditional', rd.max_files
  from private.application_required_documents(v_app.id) rd
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
    and d.document_type_id not in (select rd.document_type_id from private.application_required_documents(v_app.id) rd);

  update public.application_documents d
    set out_of_scope = true, requirement = 'optional', not_applicable = false
  where d.application_id = v_app.id
    and d.document_type_id is not null
    and d.document_type_id not in (select rd.document_type_id from private.application_required_documents(v_app.id) rd);
end;
$$;

-- Saves a rule (combination + its documents) in one go; staff only (RLS checks too). If no rule id is given
-- a new rule is created. Documents: [{"document_type_id": "...", "requirement": "required"}, ...].
-- Runs with the caller's permissions (SECURITY INVOKER); the save either happens completely or not at all.
create function public.save_document_rule(p_id uuid, p_application_types text[], p_sponsor_status text, p_items jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items_invalid' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.document_rules (application_types, sponsor_status)
    values (coalesce(p_application_types, '{}'), p_sponsor_status)
    returning id into v_id;
  else
    update public.document_rules
      set application_types = coalesce(p_application_types, '{}'), sponsor_status = p_sponsor_status
      where id = v_id;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.document_rule_items where rule_id = v_id;
  insert into public.document_rule_items (rule_id, document_type_id, requirement)
  select v_id, item ->> 'document_type_id', coalesce(item ->> 'requirement', 'required')
  from jsonb_array_elements(p_items) as t (item);
  return v_id;
end;
$$;
revoke all on function public.save_document_rule(uuid, text[], text, jsonb) from public, anon;
grant execute on function public.save_document_rule(uuid, text[], text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Appointment preference: at least 1, at most 3 days (replaces the definition in migration 10)
-- ---------------------------------------------------------------------------
create or replace function public.svc_set_appointment_preferences(
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
  -- 1–3 days for both the normal preference and "dates don't suit me".
  if v_count < 1 or v_count > 3 then
    raise exception 'one_to_three_preferences_required' using errcode = 'P0001';
  end if;
  -- Each day is picked once in the calendar.
  if (select count(distinct item ->> 'date') from jsonb_array_elements(p_preferences) as t (item)) <> v_count then
    raise exception 'duplicate_preference_date' using errcode = 'P0001';
  end if;

  delete from public.appointment_preferences where application_id = p_application_id;
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

-- Submission: at least one preference (replaces the definition in migration 9; only the preference count rule changed).
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
  if v_preference_count not between 1 and 3 then
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
