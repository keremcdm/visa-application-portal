-- =============================================================================
-- Migration 16: retention period and automatic deletion of closed applications
-- =============================================================================
-- applications that were concluded or cancelled should be deleted automatically once the set period has
-- passed; the period is entered in Settings → General; until it is entered
-- NOTHING is deleted (the setting is empty).
--
-- For an expired application the documents (from storage), form answers, document and file records, appointment preferences,
-- messages, internal notes, tasks and notifications are permanently deleted. Only the application number is written to the
-- audit log (no personal data). The customer's account is not deleted.
--
-- The server does the deletion: first it fetches the expired applications and file paths, deletes the files in storage, then
-- deletes the application (both functions are called only with the service role and re-check the condition in the database).
--
-- DATA: this file deletes no rows; it only adds one (empty) settings row and two functions. If run a second time
-- it stops with an "already exists" error on the first statement.

-- Moment of closing: when the result was sent if it was sent, the last update if cancelled.
create function public.svc_expired_applications(p_limit integer default 20)
returns table (application_id uuid, reference_code text, storage_paths text[])
language sql
stable
security definer
set search_path = ''
as $$
  with setting as (
    select (s.value #>> '{}')::integer as months
    from public.settings s
    where s.key = 'retention.closed_months' and jsonb_typeof(s.value) = 'number'
  )
  select a.id, a.reference_code,
         coalesce(array_agg(f.storage_path order by f.storage_path) filter (where f.storage_path is not null), '{}'::text[])
  from public.applications a
  cross join setting st
  left join public.application_files f on f.application_id = a.id
  where st.months between 1 and 240
    and a.status in ('result_communicated', 'cancelled')
    and coalesce(a.visa_outcome_at, a.updated_at) < now() - make_interval(months => st.months)
  group by a.id, a.reference_code, a.visa_outcome_at, a.updated_at
  order by coalesce(a.visa_outcome_at, a.updated_at)
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create function public.svc_delete_expired_application(p_application_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_months integer;
begin
  select (s.value #>> '{}')::integer into v_months
  from public.settings s
  where s.key = 'retention.closed_months' and jsonb_typeof(s.value) = 'number';
  if v_months is null or v_months not between 1 and 240 then
    return false;
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    return false;
  end if;
  if v_app.status not in ('result_communicated', 'cancelled')
     or coalesce(v_app.visa_outcome_at, v_app.updated_at) >= now() - make_interval(months => v_months) then
    return false;
  end if;

  -- Written before the record is deleted; once the application is deleted the link is cleared and the application number remains.
  perform private.write_audit(null, 'application.retention_deleted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('reference_code', v_app.reference_code, 'months', v_months));
  delete from public.applications where id = p_application_id;
  return true;
end;
$$;

revoke all on function public.svc_expired_applications(integer) from public, anon, authenticated;
revoke all on function public.svc_delete_expired_application(uuid) from public, anon, authenticated;
grant execute on function public.svc_expired_applications(integer) to service_role;
grant execute on function public.svc_delete_expired_application(uuid) to service_role;

-- Retention period setting (months). Empty (null) = automatic deletion off. Only staff can see and change it.
insert into public.settings (key, value, visibility) values ('retention.closed_months', 'null', 'staff')
on conflict (key) do nothing;
