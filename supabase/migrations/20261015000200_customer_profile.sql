-- =============================================================================
-- Vize Başvuru Portalı — customers correcting their own details
-- =============================================================================
-- the customer sees and corrects their personal details on the "Hesabım" (My Account) page.
--
-- A user can change only their first name, last name and date of birth, only on THEIR OWN row.
-- No permission is granted for role, account status or e-mail (the e-mail changes through Supabase Auth).
-- This file deletes or changes no data; it only adds a grant and a row policy.
-- If run a second time it stops with an "already exists" error on the first statement and nothing changes
-- (the SQL Editor runs the file as a single transaction).

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant update (first_name, last_name, birth_date) on public.profiles to authenticated;
