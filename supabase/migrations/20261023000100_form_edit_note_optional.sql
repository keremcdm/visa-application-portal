-- =============================================================================
-- Migration 22: the note on a form edit request is optional
-- =============================================================================
-- the customer should not have to write anything when asking to change their submitted
-- form. svc_request_form_edit in migration 17 required the note to be 1–1000 characters; now the note can be left
-- empty (stored as NULL if empty) and is at most 1000 characters. All other rules are the same.
-- (The consultant refusing a request without a reason is app-only; it requires no database change.)
--
-- DATA: no row is deleted or changed; only the function is redefined. It can be run a second time.

create or replace function public.svc_request_form_edit(p_actor_id uuid, p_application_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Changing the form after the appointment makes no sense; it cannot be requested for cancelled or concluded applications either.
  if v_app.status not in ('submitted', 'in_review', 'awaiting_customer', 'documents_complete') then
    raise exception 'form_edit_request_not_allowed' using errcode = 'P0001';
  end if;
  if not v_app.form_locked then
    raise exception 'form_already_open' using errcode = 'P0001';
  end if;
  if v_app.form_edit_requested_at is not null then
    raise exception 'form_edit_already_requested' using errcode = 'P0001';
  end if;
  -- The note is optional (migration 22); only its length is limited.
  if char_length(v_note) > 1000 then
    raise exception 'form_edit_note_invalid' using errcode = '22023';
  end if;

  update public.applications
    set form_edit_requested_at = now(), form_edit_request_note = nullif(v_note, '')
    where id = p_application_id;
  perform private.write_audit(p_actor_id, 'form.edit_requested', p_application_id, 'application', p_application_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.svc_request_form_edit(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_request_form_edit(uuid, uuid, text) to service_role;
