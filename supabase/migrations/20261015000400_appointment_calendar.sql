-- =============================================================================
-- Vize Başvuru Portalı — appointment preferences from a calendar
-- =============================================================================
-- appointment preferences are always picked from a calendar. The customer picks each day
-- once and says "Tam gün" (all day), "Öğleden önce" (morning) or "Öğleden sonra" (afternoon).
--   * Normal preference: three different days ("Tam gün" is now accepted here too).
--   * "Bu tarihlerin hiçbiri bana uymuyor": 1–3 different days (unchanged).
--
-- This file only redefines the svc_set_appointment_preferences function. It changes no table, data or grant;
-- it deletes nothing. Previously saved preferences stay as they are (old records with two time slots on the same day
-- remain valid; the new rule only applies when saving again). Since it is `create or replace`,
-- running it a second time by accident changes nothing; the existing execute grants (service_role only) are kept.

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
  if p_outside_window then
    -- If the offered dates don't suit: 1–3 days from later working days.
    if v_count < 1 or v_count > 3 then
      raise exception 'one_to_three_preferences_required' using errcode = 'P0001';
    end if;
  elsif v_count <> 3 then
    raise exception 'three_preferences_required' using errcode = 'P0001';
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
