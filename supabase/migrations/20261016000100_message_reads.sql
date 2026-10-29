-- =============================================================================
-- Migration 11: "read" state of consultant messages
-- =============================================================================
-- Unread messages are marked on the application status page ("1 yeni"); a message is marked read when the customer clicks it.
-- The customer has NO write grant on the message table: the read time is only written through the function below, only for
-- a message in their own application and only once. The message's text, author and date never change.

alter table public.application_messages add column if not exists customer_read_at timestamptz;

create or replace function public.mark_message_read(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  -- Inside SECURITY DEFINER permission is checked with auth.uid() (private.is_privileged() always returns true here).
  select exists (
    select 1
    from public.application_messages m
    join public.applications a on a.id = m.application_id
    where m.id = p_message_id and a.customer_id = (select auth.uid())
  ) into v_found;
  if not v_found then
    return false;
  end if;
  update public.application_messages
    set customer_read_at = now()
    where id = p_message_id and customer_read_at is null;
  return true;
end;
$$;

revoke all on function public.mark_message_read(uuid) from public, anon;
grant execute on function public.mark_message_read(uuid) to authenticated;
