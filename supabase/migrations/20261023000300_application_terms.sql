-- =============================================================================
-- Migration 24: acceptance of the application terms of service
-- =============================================================================
-- before submitting their application the customer reads and accepts the "Başvuru Hizmet Şartları ve Onay
-- Beyanı" (application terms of service and declaration of consent, /application-terms). The acceptance is recorded,
-- linked to the application, with the text's version and time; a draft whose terms were not accepted cannot be submitted (the database checks too).
--
-- The record is only written with svc_accept_application_terms through the service role (the app calls it after verifying
-- the customer's identity and the confirmations they ticked); the function re-checks the application's owner and that it is a draft.
-- The customer can read their own record, staff all records; no session can write. When an application is deleted its record is deleted too.
--
-- DATA: no row is deleted or changed; a table, a function and a trigger are added. Previously submitted
-- applications are not affected (the check only happens on the transition from draft to submitted). If run a second time
-- it stops with an "already exists" error on the first statement.

create table public.application_terms_acceptances (
  application_id uuid primary key references public.applications (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  terms_version text not null check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default now()
);
alter table public.application_terms_acceptances enable row level security;
revoke all on public.application_terms_acceptances from public, anon, authenticated;
grant select on public.application_terms_acceptances to authenticated;
create policy application_terms_select on public.application_terms_acceptances
  for select to authenticated
  using (private.owns_application(application_id) or private.is_staff());

-- Records that the customer accepted the terms (right before submission). Only the application's owner and only for a draft.
create function public.svc_accept_application_terms(p_actor_id uuid, p_application_id uuid, p_version text)
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
    raise exception 'application_not_editable' using errcode = '42501';
  end if;
  if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid_terms_version' using errcode = '22023';
  end if;

  insert into public.application_terms_acceptances (application_id, customer_id, terms_version, accepted_at)
    values (p_application_id, p_actor_id, p_version, now())
    on conflict (application_id) do update
      set customer_id = excluded.customer_id, terms_version = excluded.terms_version, accepted_at = excluded.accepted_at;
  perform private.write_audit(p_actor_id, 'application.terms_accepted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('version', p_version));
end;
$$;
revoke all on function public.svc_accept_application_terms(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_accept_application_terms(uuid, uuid, text) to service_role;

-- The terms must have been accepted for the transition from draft to submitted.
create function private.require_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status <> 'draft'
     and not exists (select 1 from public.application_terms_acceptances t where t.application_id = new.id) then
    raise exception 'terms_not_accepted' using errcode = 'P0001',
      hint = 'Başvuru hizmet şartları kabul edilmeden başvuru gönderilemez.';
  end if;
  return new;
end;
$$;
revoke all on function private.require_terms_acceptance() from public, anon, authenticated;

create trigger applications_require_terms before update of status on public.applications
  for each row execute function private.require_terms_acceptance();
