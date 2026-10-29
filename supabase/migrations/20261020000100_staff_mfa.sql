-- =============================================================================
-- Migration 15: two-factor authentication mandatory for staff
-- =============================================================================
-- consultant accounts can access every customer's documents, so the data must stay out of reach even if a password
-- is stolen. Staff permissions are only granted in a session that passed two-factor authentication (the code from the
-- authenticator app was entered). The app applies the same rule (src/server/auth.ts); this file makes the
-- database the last line of defense: a staff session without the code that sends requests directly to the API
-- looks like an ordinary user (it cannot see or change someone else's application, files or notes).
--
-- DATA: no row is changed or deleted. If run a second time it stops with an "already exists" error on the first statement.
--
-- IMPORTANT: After this file is run, staff must set up two-factor authentication before entering the admin panel
-- (after signing in the app opens the setup page by itself). In the Supabase dashboard, "TOTP" must be enabled under
-- Authentication → Multi-Factor (it is enabled by default).

-- ---------------------------------------------------------------------------
-- 1. Record of resetting a staff member's two-factor authentication (Settings → Staff). Called ONLY by the service role;
--    the server calls it after verifying the acting staff member's permission. Who reset whose authentication
--    is written to the audit log.
-- ---------------------------------------------------------------------------
create function public.svc_record_staff_security_event(p_actor_id uuid, p_action text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action is distinct from 'staff.mfa_reset' then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_target_id and p.role = 'staff') then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;
  perform private.write_audit(p_actor_id, p_action, null, 'profile', p_target_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.svc_record_staff_security_event(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.svc_record_staff_security_event(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Staff permission (replaces the definition in migration 2): an active staff account AND a session with two-factor authentication.
--    The "aal" value in the access token is read from the token signed by Supabase Auth; the client cannot change it.
--    RLS policies, the storage policy, triggers and staff functions use this function.
-- ---------------------------------------------------------------------------
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'staff' and p.is_active
    );
$$;
