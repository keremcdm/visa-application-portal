-- =============================================================================
-- Migration 19: "Randevu gerçekleşti" once the appointment time has passed
-- =============================================================================
-- Problem fixed: the application did not move to "Randevu gerçekleşti" / "Sonuç bekleniyor" even though the
-- appointment had passed. There were two reasons:
--   1. The rule was "once the appointment DAY has passed" (the appointment waited until the next day).
--   2. The transition was only done by a scheduled job (pg_cron) that has to be set up separately in Supabase; it had not been set up.
-- Now the transition happens once the appointment TIME has passed, and the app also does it when pages open (at most once a minute):
-- svc_complete_past_appointments is only called with the service role. If the scheduled job is set up it runs as a backup.
--
-- DATA: no row is deleted. The functions are redefined; on the first call sent appointments whose time has passed
-- become "Randevu gerçekleşti" and the customer is notified (as the rule requires). If run a second time it stops with
-- an "already exists" error on the second function.

-- Sets appointments in the "Randevu tarihi bildirildi" status whose time (Istanbul) has passed to "Randevu gerçekleşti"; the
-- application moves to "Sonuç bekleniyor" according to the rule and the customer is notified. Returns the number of applications processed.
create or replace function private.complete_past_appointments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select a.id, a.customer_id
    from public.applications a
    where a.appointment_status = 'scheduled'
      and a.appointment_at is not null
      and a.appointment_at <= now()
      and a.status not in ('draft', 'cancelled', 'result_communicated')
    for update skip locked
  loop
    update public.applications set appointment_status = 'completed' where id = v_row.id;
    perform private.write_audit(null, 'appointment.completed', v_row.id, 'application', v_row.id::text, '{}'::jsonb);
    insert into public.notifications (user_id, application_id, kind, title, body)
    values (v_row.customer_id, v_row.id, 'appointment.completed', 'Randevunuz gerçekleşti',
            'Vize kararını yetkili makam verir. Sonuç açıklandığında size bildirilecektir.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Entry point called by the app (server, service role). Not open to any session.
create function public.svc_complete_past_appointments()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.complete_past_appointments();
$$;

revoke all on function public.svc_complete_past_appointments() from public, anon, authenticated;
grant execute on function public.svc_complete_past_appointments() to service_role;
