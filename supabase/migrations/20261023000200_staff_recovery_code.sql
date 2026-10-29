-- =============================================================================
-- Migration 23: recovery code for two-factor authentication
-- =============================================================================
-- a staff member who lost their phone (authenticator app) can set up authentication again themselves without
-- waiting for another admin. For this every staff member has a single recovery code: 20 characters,
-- mixed letters and digits (e.g. K7Q4-9MZD-X2PH-RT6W-8BNC). The code is shown on screen only once, when it is created;
-- the database stores its SHA-256 digest, never the code itself. A used code is deleted; the person creates a new code
-- after setting up authentication again. The recovery code can only be used in a session signed in with the password
-- (password + recovery code = two separate factors), so it does not weaken the protection of two-factor authentication.
--
-- The table is in the private schema (not exposed to the database API) and no session can read/write it directly; all
-- operations go through the three functions below, with the service role only. The app calls them after verifying the
-- person's identity; the functions re-check that the person is active staff. After 5 wrong attempts in a row the person
-- must wait 15 minutes. Creation, use and wrong attempts are written to the audit log (never the code or its digest).
--
-- DATA: no row is deleted or changed; only a table and three functions are added. If run a second time
-- it stops with an "already exists" error on the first statement.

create table private.staff_recovery_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table private.staff_recovery_codes enable row level security;
revoke all on private.staff_recovery_codes from public, anon, authenticated;

-- Creates or renews the recovery code (the old one becomes invalid). Active staff only.
create function public.svc_set_staff_recovery_code(p_user_id uuid, p_code_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'staff' and p.is_active) then
    raise exception 'not_staff' using errcode = '42501';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_code_hash' using errcode = '22023';
  end if;
  insert into private.staff_recovery_codes (user_id, code_hash, created_at)
    values (p_user_id, p_code_hash, now())
    on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = excluded.created_at;
  perform private.write_audit(p_user_id, 'staff.recovery_code_created', null, 'profile', p_user_id::text, '{}'::jsonb);
end;
$$;

-- Tries the recovery code. If correct the code is deleted and true is returned (the app then deletes the authenticator factor);
-- if wrong the attempt is recorded and false is returned. With 5 wrong attempts in the last 15 minutes it is not tried at all.
create function public.svc_use_staff_recovery_code(p_user_id uuid, p_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failures integer;
  v_deleted integer;
begin
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'staff' and p.is_active) then
    raise exception 'not_staff' using errcode = '42501';
  end if;
  select count(*) into v_failures from public.audit_log
    where actor_id = p_user_id and action = 'staff.recovery_code_failed' and created_at > now() - interval '15 minutes';
  if v_failures >= 5 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;

  delete from private.staff_recovery_codes
    where user_id = p_user_id and code_hash = coalesce(p_code_hash, '');
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    perform private.write_audit(p_user_id, 'staff.recovery_code_failed', null, 'profile', p_user_id::text, '{}'::jsonb);
    return false;
  end if;
  perform private.write_audit(p_user_id, 'staff.recovery_code_used', null, 'profile', p_user_id::text, '{}'::jsonb);
  return true;
end;
$$;

-- When the person's recovery code was created (NULL if none). The code itself cannot be read in any way.
create function public.svc_staff_recovery_code_created_at(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select created_at from private.staff_recovery_codes where user_id = p_user_id;
$$;

revoke all on function public.svc_set_staff_recovery_code(uuid, text) from public, anon, authenticated;
revoke all on function public.svc_use_staff_recovery_code(uuid, text) from public, anon, authenticated;
revoke all on function public.svc_staff_recovery_code_created_at(uuid) from public, anon, authenticated;
grant execute on function public.svc_set_staff_recovery_code(uuid, text) to service_role;
grant execute on function public.svc_use_staff_recovery_code(uuid, text) to service_role;
grant execute on function public.svc_staff_recovery_code_created_at(uuid) to service_role;
