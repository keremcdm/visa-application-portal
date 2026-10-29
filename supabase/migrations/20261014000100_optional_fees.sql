-- =============================================================================
-- Vize Başvuru Portalı — submission without a fee breakdown
-- =============================================================================
-- since no fixed price is offered to the customer, the portal does not show fee
-- items and submission does not depend on a fee breakdown.
--
-- This file only changes the svc_submit_application function: an empty fee list is now
-- accepted. It changes no table, data or grant; it deletes nothing. Since it is `create or replace`,
-- running it a second time by accident changes nothing. The function's existing execute grants
-- (service_role only) are kept.
--
-- The fee_items and application_fee_items tables and the surcharge columns in the cities table stay in place;
-- they can be reused later with fixed prices. If a fee list is given it is saved as before.

create or replace function public.svc_submit_application(
  p_actor_id uuid,
  p_application_id uuid,
  p_fee_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_fee_count integer;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_app.customer_id is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_app.status <> 'draft' then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;
  if p_fee_items is null or jsonb_typeof(p_fee_items) <> 'array' then
    raise exception 'fees_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.appointment_preferences where application_id = p_application_id) <> 3 then
    raise exception 'appointment_preferences_missing' using errcode = 'P0001';
  end if;

  v_fee_count := jsonb_array_length(p_fee_items);

  delete from public.application_fee_items where application_id = p_application_id;
  insert into public.application_fee_items (application_id, label, kind, amount, currency, sort_order)
  select p_application_id, item ->> 'label', item ->> 'kind', (item ->> 'amount')::numeric, item ->> 'currency', ordinality::int
  from jsonb_array_elements(p_fee_items) with ordinality as t (item, ordinality);

  update public.applications
    set status = 'submitted',
        form_locked = true,
        payment_status = 'awaiting_payment',
        appointment_status = 'preferences_submitted',
        submitted_at = now(),
        fees_snapshot_at = case when v_fee_count > 0 then now() else null end
    where id = p_application_id;

  perform private.write_audit(p_actor_id, 'application.submitted', p_application_id, 'application', p_application_id::text,
    jsonb_build_object('fee_item_count', v_fee_count));
end;
$$;
