-- =============================================================================
-- Migration 27: an admin permanently deleting an application
-- =============================================================================
-- test applications created by consultants, and any application when needed, can be deleted
-- from the admin panel. Deletion is only for active ADMIN staff (like staff management);
-- for a submitted application the app additionally asks for the application number to be typed.
--
-- Deleted: the application and every record attached to it (form answers, documents and file records, appointment preferences,
-- messages, internal notes, tasks, notifications, terms acceptance). The storage paths of the files are returned; the app deletes
-- them from storage. The customer's account is not deleted. "application.deleted" (application number, status, who deleted) is
-- written to the audit log; once the application is deleted the entry's application link is cleared and the number remains.
--
-- DATA: this file changes or deletes no rows; it only adds the function. It can be run a second time.

create or replace function public.svc_delete_application(p_actor_id uuid, p_application_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  -- CAUTION: inside SECURITY DEFINER private.is_privileged() always returns true; permission is checked against the profile
  -- with the actor's identity (the app calls it after verifying the identity from the session; only the service role can call it).
  if p_actor_id is null
     or not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return query select f.storage_path from public.application_files f where f.application_id = p_application_id;

  -- Written before the record is deleted; once the application is deleted the entry's application link is cleared and the application number remains.
  perform private.write_audit(p_actor_id, 'application.deleted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('reference_code', v_app.reference_code, 'status', v_app.status));
  delete from public.applications where id = p_application_id;
end;
$$;

revoke all on function public.svc_delete_application(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_delete_application(uuid, uuid) to service_role;
