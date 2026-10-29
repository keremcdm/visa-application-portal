-- =============================================================================
-- Migration 18: "Admin" rights for staff
-- =============================================================================
-- inviting new staff, disabling/enabling a staff member's access, resetting their two-factor
-- authentication and granting/revoking admin rights are admin-only. Other actions (applications,
-- settings) stay the same for all staff.
--
--   * profiles.is_admin: is the user an admin? Sessions have no write grant on this column (on profiles only the first
--     name, last name and date of birth can be written); only svc_set_staff_admin changes its value.
--   * Staff who are ACTIVE at the moment this file runs become admins. Staff invited
--     later are not admins; an admin grants the right from Settings → Staff.
--   * svc_set_staff_access (invitation and access on/off) and svc_record_staff_security_event (authentication reset record)
--     require the actor to be an active admin. The actor can be empty (null) only in the setup script on the
--     server (npm run staff:create; only the service role can call it).
--   * Nobody can remove their own admin rights; admin changes are written to the audit log.
--
-- DATA: no row is deleted; only active staff rows get is_admin = true. If run a second time it stops with an
-- "already exists" error on the first statement.

alter table public.profiles add column is_admin boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. Audit record of profile changes (replaces the definition in migration 2): admin changes are recorded too.
-- ---------------------------------------------------------------------------
create or replace function private.profiles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- svc_* functions report the acting staff member via app.actor_id.
  v_actor uuid := coalesce((select auth.uid()), nullif(current_setting('app.actor_id', true), '')::uuid);
begin
  new.updated_at := now();
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    perform private.write_audit(
      v_actor, 'staff.access_changed', null, 'profile', new.id::text,
      jsonb_build_object('role_from', old.role, 'role_to', new.role, 'active_from', old.is_active, 'active_to', new.is_active)
    );
  end if;
  if new.is_admin is distinct from old.is_admin then
    perform private.write_audit(v_actor, 'staff.admin_changed', null, 'profile', new.id::text, jsonb_build_object('admin_to', new.is_admin));
  end if;
  return new;
end;
$$;

-- Staff active when this file runs become admins.
update public.profiles set is_admin = true where role = 'staff' and is_active;

-- ---------------------------------------------------------------------------
-- 2. Granting/revoking staff rights (replaces the definition in migration 2): the actor must be an active admin.
--    A person whose staff rights are removed also loses admin rights.
-- ---------------------------------------------------------------------------
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
  if p_actor_id is not null
     and not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_actor_id is not null and p_actor_id = p_user_id and (p_role <> 'staff' or not p_is_active) then
    raise exception 'cannot_change_own_access' using errcode = 'P0001';
  end if;
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  update public.profiles
    set role = p_role, is_active = p_is_active, is_admin = (p_role = 'staff' and is_admin)
    where id = p_user_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Granting/revoking admin rights. Called ONLY by the service role; the server calls it after verifying the actor's identity.
-- ---------------------------------------------------------------------------
create function public.svc_set_staff_admin(p_actor_id uuid, p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_is_admin is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if p_actor_id is not null
     and not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_actor_id is not null and p_actor_id = p_user_id and not p_is_admin then
    raise exception 'cannot_change_own_access' using errcode = 'P0001';
  end if;
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  update public.profiles set is_admin = p_is_admin where id = p_user_id and role = 'staff';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.svc_set_staff_admin(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.svc_set_staff_admin(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Two-factor authentication reset record (replaces the definition in migration 15): the actor must be an active admin.
-- ---------------------------------------------------------------------------
create or replace function public.svc_record_staff_security_event(p_actor_id uuid, p_action text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action is distinct from 'staff.mfa_reset' then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_target_id and p.role = 'staff') then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;
  perform private.write_audit(p_actor_id, p_action, null, 'profile', p_target_id::text, '{}'::jsonb);
end;
$$;
