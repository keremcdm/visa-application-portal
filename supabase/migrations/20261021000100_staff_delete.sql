-- =============================================================================
-- Migration 21: permanently deleting a staff account
-- =============================================================================
-- an admin can delete a staff member completely from the staff list (with a serious warning).
--
-- Deletion takes two steps: (1) svc_delete_staff in this file disables the person's access and preserves their name in past records;
-- (2) the app deletes the authentication account with the Supabase admin API (auth.users → profiles is deleted; fields linked to
-- this person are cleared by the "on delete set null" rule from the first migration).
--
-- The person's audit history, internal notes and messages they wrote to customers are NOT DELETED. In the audit log and internal
-- notes their name keeps showing with a "(silinmiş personel)" (deleted staff) suffix (actor_label / author_label; only staff read
-- them). Messages get no name label: customers read message rows too; in the admin panel the author shows as "Silinmiş personel".
--
-- DATA: no row is deleted or changed; only two columns are added. If run a second time it stops with an
-- "already exists" error on the first statement.

alter table public.audit_log add column actor_label text check (char_length(actor_label) <= 200);
alter table public.staff_notes add column author_label text check (char_length(author_label) <= 200);

-- Staff cannot write the name label when adding a note (only svc_delete_staff writes it during deletion).
drop policy staff_notes_staff_insert on public.staff_notes;
create policy staff_notes_staff_insert on public.staff_notes
  for insert to authenticated
  with check (private.is_staff() and author_id = (select auth.uid()) and author_label is null);

-- Prepares a staff member for deletion: disables access and admin rights, preserves their name in past records, records the action.
-- Called ONLY by the service role; the server calls it after verifying the actor's identity. The actor must be an active
-- admin; nobody can delete themselves; only staff accounts are deleted (a customer account cannot be deleted this way).
create function public.svc_delete_staff(p_actor_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_label text;
begin
  if p_actor_id is null
     or not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'staff' and p.is_active and p.is_admin) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_actor_id = p_user_id then
    raise exception 'cannot_change_own_access' using errcode = 'P0001';
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found or v_target.role <> 'staff' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_label := left(
    coalesce(nullif(trim(concat_ws(' ', v_target.first_name, v_target.last_name)), ''), v_target.email, 'Personel') || ' (silinmiş personel)',
    200
  );

  perform set_config('app.actor_id', p_actor_id::text, true);
  -- Even if the identity account cannot be deleted, the person no longer holds staff rights.
  update public.profiles set is_active = false, is_admin = false where id = p_user_id;

  update public.audit_log set actor_label = v_label where actor_id = p_user_id;
  update public.staff_notes set author_label = v_label where author_id = p_user_id;

  perform private.write_audit(p_actor_id, 'staff.deleted', null, 'profile', p_user_id::text, jsonb_build_object('name', v_label));
end;
$$;

revoke all on function public.svc_delete_staff(uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_delete_staff(uuid, uuid) to service_role;
