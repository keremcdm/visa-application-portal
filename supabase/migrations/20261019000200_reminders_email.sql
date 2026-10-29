-- =============================================================================
-- Migration 14: customer reminder record and e-mail notifications
-- =============================================================================
-- Scope:
--   1. The "Müşteriye hatırlat" (remind customer) button in the admin panel sends the customer a notification and is recorded
--      in the audit log as "customer.reminded" ("Son hatırlatma: …" is read from this entry).
--   2. Every in-app notification sent to the customer is also sent as an e-mail. The server does the sending
--      (SMTP details are in server environment variables); the database only tracks which notification was sent.
--
-- DATA: no row is changed or deleted; three columns and two server functions are added to the notifications table,
-- and record_staff_event is redefined. If run a second time it stops with an "already exists" error on the first statement.

alter table public.notifications
  add column email_attempts smallint not null default 0 check (email_attempts between 0 and 20),
  add column email_claimed_at timestamptz,
  add column email_error text check (char_length(email_error) <= 300);
-- No new grant is given to sessions: the customer can only change the read_at column (migration 2).

-- To find notifications waiting to be sent quickly.
create index notifications_email_pending_idx on public.notifications (created_at) where email_sent_at is null;

-- ---------------------------------------------------------------------------
-- 1. Server-side event record for staff ("customer.reminded" added; replaces the definition in migration 2).
-- ---------------------------------------------------------------------------
create or replace function public.record_staff_event(
  p_action text,
  p_application_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_action !~ '^(export|form_pdf|file|customer)\.[a-z_]{1,40}$' then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  perform private.write_audit((select auth.uid()), p_action, p_application_id, 'application', p_application_id::text, p_details);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. E-mail queue. Called ONLY by the service role (the server, right before and after sending).
--    * Notifications created in the last two days, not sent, tried fewer than 5 times are taken. Older notifications
--      are not sent as e-mail (so old notifications are not sent in bulk once SMTP is configured later).
--    * A taken row is not taken by another sender for 10 minutes (so the same e-mail is not sent twice).
-- ---------------------------------------------------------------------------
create or replace function public.svc_claim_notification_emails(p_limit integer default 20)
returns table (
  id uuid,
  kind text,
  title text,
  body text,
  application_id uuid,
  created_at timestamptz,
  email text,
  first_name text,
  reference_code text
)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select n.id
    from public.notifications n
    where n.email_sent_at is null
      and n.email_attempts < 5
      and n.created_at > now() - interval '2 days'
      and (n.email_claimed_at is null or n.email_claimed_at < now() - interval '10 minutes')
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of n skip locked
  ),
  claimed as (
    update public.notifications n
    set email_claimed_at = now(), email_attempts = n.email_attempts + 1
    from picked
    where n.id = picked.id
    returning n.id, n.kind, n.title, n.body, n.application_id, n.created_at, n.user_id
  )
  select c.id, c.kind, c.title, c.body, c.application_id, c.created_at, p.email, p.first_name, a.reference_code
  from claimed c
  join public.profiles p on p.id = c.user_id
  left join public.applications a on a.id = c.application_id
  order by c.created_at;
$$;

create or replace function public.svc_finish_notification_email(p_id uuid, p_sent boolean, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set email_sent_at = case when p_sent then now() else null end,
      email_claimed_at = case when p_sent then email_claimed_at else null end,
      email_error = case when p_sent then null else left(coalesce(nullif(p_error, ''), 'unknown'), 300) end
  where id = p_id;
$$;

revoke all on function public.svc_claim_notification_emails(integer) from public, anon, authenticated;
revoke all on function public.svc_finish_notification_email(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.svc_claim_notification_emails(integer) to service_role;
grant execute on function public.svc_finish_notification_email(uuid, boolean, text) to service_role;
