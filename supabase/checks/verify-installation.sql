-- =============================================================================
-- Vize Başvuru Portalı — installation check (READ ONLY)
-- =============================================================================
-- Run in the Supabase SQL Editor after all migration files have been applied.
-- Changes nothing; it only counts and checks permissions. The "status" column
-- of every row must read OK. If any row shows MISMATCH, do not continue.
--
-- The expected values are updated together with the migrations (tests/db/migrations.test.ts verifies this).
with checks (no, check_name, expected, actual) as (
  select 1, 'number of tables in the public schema', '23',
    (select count(*)::text from pg_tables where schemaname = 'public')
  union all
  select 2, 'number of tables with RLS disabled', '0',
    (select count(*)::text from pg_tables where schemaname = 'public' and not rowsecurity)
  union all
  select 3, 'number of policies in the public schema', '69',
    (select count(*)::text from pg_policies where schemaname = 'public')
  union all
  select 4, 'storage read policy', '1',
    (select count(*)::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname like 'application-files:%')
  union all
  select 5, 'number of triggers on public tables', '28',
    (select count(*)::text from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal)
  union all
  select 6, 'triggers on auth.users', '2',
    (select count(*)::text from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and c.relname = 'users'
        and t.tgname in ('on_auth_user_created', 'on_auth_user_email_changed'))
  union all
  select 7, 'number of functions in the private schema', '25',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private')
  union all
  select 8, 'number of functions in the public schema', '30',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')
  union all
  select 9, 'table grants of the anon role', 'settings:SELECT',
    (select coalesce(string_agg(c.relname || ':' || p.priv, ', ' order by c.relname, p.priv), '(none)')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (priv)
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'p') and has_table_privilege('anon', c.oid, p.priv))
  union all
  select 10, 'number of functions the anon role can execute', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
  union all
  select 11, 'public functions a signed-in user can call', 'application_status_history, delete_document_type, mark_message_read, record_staff_event, save_document_rule, sync_application_documents',
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute'))
  union all
  select 12, 'private functions a signed-in user can call', 'customer_action_outstanding, is_privileged, is_staff, next_reference_code, owns_application',
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute'))
  union all
  select 13, 'can a signed-in user delete applications', 'false',
    (select (has_table_privilege('authenticated', 'public.applications', 'DELETE')
          or has_table_privilege('authenticated', 'public.applications', 'TRUNCATE'))::text)
  union all
  -- On profiles only the first name, last name and date of birth columns are granted (row 27); there is no table-level write grant.
  select 14, 'can a signed-in user write profiles, file records or audit entries', 'false',
    (select bool_or(has_table_privilege('authenticated', c.oid, p.priv))::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p (priv)
      where n.nspname = 'public' and c.relname in ('profiles', 'application_files', 'audit_log'))
  union all
  select 15, 'sequence grants of anon or signed-in users', 'false',
    (select coalesce(bool_or(has_sequence_privilege(r.role, c.oid, 'USAGE') or has_sequence_privilege(r.role, c.oid, 'SELECT')), false)::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) as r (role)
      where n.nspname = 'public' and c.relkind = 'S')
  union all
  select 16, 'storage bucket', 'private, 10485760 bytes, 3 types',
    (select case when public then 'PUBLIC' else 'private' end || ', ' || file_size_limit || ' bytes, ' || cardinality(allowed_mime_types) || ' types'
      from storage.buckets where id = 'application-files')
  union all
  -- ZIP folders and document types are not counted: the company can add and delete them in the admin panel, so their counts change after installation.
  select 17, 'initial data (number of settings)', '14',
    (select count(*)::text from public.settings)
  union all
  -- The third letter of the "Geçerli pasaport" label must be "ç" (U+00E7 = 231); if the
  -- character encoding got corrupted while pasting, this row shows MISMATCH.
  select 18, 'were Turkish characters loaded intact', 'true',
    (select (ascii(substr(label, 3, 1)) = 231)::text from public.document_types where id = 'passport')
  union all
  -- If 20261014000100_optional_fees.sql was applied, the submission function does not reject an empty fee list.
  select 19, 'an application can be submitted without a fee breakdown (migration 4 applied?)', 'true',
    (select (pg_get_functiondef(p.oid) not like '%fees_missing%')::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'svc_submit_application')
  union all
  -- 20261014000200_risk_assessments.sql: users can perform the four operations only on their own row (RLS limits the row).
  select 20, 'signed-in user grants on the risk test table (migration 5 applied?)', 'DELETE, INSERT, SELECT, UPDATE',
    (select coalesce(string_agg(p.priv, ', ' order by p.priv), '(none)')
      from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (priv)
      where has_table_privilege('authenticated', to_regclass('public.risk_assessments'), p.priv))
  union all
  -- 20261014000300_visa_outcome_random_reference.sql: visa outcome columns, file type and random reference.
  select 21, 'visa outcome columns (migration 6 applied?)', 'visa_outcome, visa_outcome_at, visa_outcome_file_id, visa_outcome_note',
    (select coalesce(string_agg(column_name::text, ', ' order by column_name), '(none)')
      from information_schema.columns
      where table_schema = 'public' and table_name = 'applications' and column_name like 'visa_outcome%')
  union all
  select 22, 'the visa outcome screenshot is accepted as a file type', 'true',
    (select (pg_get_constraintdef(c.oid) like '%visa_result%')::text
      from pg_constraint c where c.conname = 'application_files_kind_check')
  union all
  select 23, 'new application numbers are random, not sequential', 'true',
    (select (pg_get_functiondef(p.oid) not like '%nextval%' and pg_get_functiondef(p.oid) like '%random()%')::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'next_reference_code')
  union all
  -- 20261015000100_document_rules.sql: age-dependent document rule, new document types and the "not applicable" rule.
  select 24, 'age-based document rule and new document types (migration 7 applied?)', 'true',
    (select (exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'document_types' and column_name = 'minors_only')
         and (select count(*) from public.document_types where id in ('self_invoices_or_z_reports', 'parental_consent')) = 2)::text)
  union all
  select 25, 'the “not applicable” option cannot be enabled on any document', 'true',
    (select (count(*) = 1)::text from pg_constraint where conname = 'document_types_not_applicable_conditional_only')
  union all
  -- Since migration 20 the under-18 rule lives in private.application_required_documents, which the sync uses.
  select 26, 'the document list is synced with the under-18 rule', 'true',
    (select (pg_get_functiondef(p.oid) like '%applicant_is_minor%')::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'application_required_documents')
  union all
  -- 20261015000200_customer_profile.sql: a customer can change only these three columns, only on their own row.
  select 27, 'profile columns a signed-in user can change (migration 8 applied?)', 'birth_date, first_name, last_name',
    (select coalesce(string_agg(column_name::text, ', ' order by column_name), '(none)')
      from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE')
  union all
  -- 20261015000300_notifications_dates_accounts.sql: "dates don't suit me", notification deletion, account deletion, document deletion.
  select 28, '“dates do not suit me”, notification deletion and account deletion (migration 9 applied?)', 'true',
    (select (exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'applications' and column_name = 'appointment_outside_window')
         and has_table_privilege('authenticated', 'public.notifications', 'DELETE')
         and to_regclass('public.account_deletion_requests') is not null
         and to_regprocedure('public.svc_delete_account_data(uuid, uuid)') is not null
         and to_regprocedure('public.svc_set_appointment_preferences(uuid, uuid, jsonb)') is null)::text)
  union all
  -- 20261015000400_appointment_calendar.sql: preferences from a calendar; "Tüm gün" (old name "Tam gün") for normal preferences too, each day once.
  select 29, 'appointment preferences from a calendar (migration 10 applied?)', 'true',
    (select (pg_get_functiondef(p.oid) not like '%full_day%' and pg_get_functiondef(p.oid) like '%duplicate_preference_date%')::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'svc_set_appointment_preferences')
  union all
  -- 20261016000100_message_reads.sql: read state of consultant messages; the customer has no write grant on the message table.
  select 30, 'message read state (migration 11 applied?)', 'true',
    (select (exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'application_messages' and column_name = 'customer_read_at')
         and not has_table_privilege('authenticated', 'public.application_messages', 'UPDATE')
         and to_regprocedure('public.mark_message_read(uuid)') is not null)::text)
  union all
  -- 20261016000200_automatic_status.sql: automatic status, appointment locations, the "Randevu gerçekleşti" function; old statuses removed.
  select 31, 'automatic status and appointment locations (migration 12 applied?)', 'true',
    (select (to_regclass('public.appointment_locations') is not null
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'applications' and column_name = 'appointment_address')
         and to_regprocedure('private.complete_past_appointments()') is not null
         and (select count(*) from pg_trigger where tgname = 'applications_status_sync') = 1
         and (select pg_get_constraintdef(c.oid) not like '%visa_submitted%'
              from pg_constraint c where c.conname = 'applications_status_check'))::text)
  union all
  -- 20261019000100_drafts_reopen.sql: previous stage restored when a cancellation is undone; customer deleting their draft (called only by the server).
  select 32, 'pre-cancellation stage and draft deletion (migration 13 applied?)', 'true',
    (select (exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'applications' and column_name = 'cancelled_from_status')
         and to_regprocedure('public.svc_delete_draft(uuid, uuid)') is not null
         and not has_function_privilege('authenticated', 'public.svc_delete_draft(uuid, uuid)', 'execute'))::text)
  union all
  -- 20261019000200_reminders_email.sql: e-mail send queue (called only by the server) and the "Müşteriye hatırlat" record.
  select 33, 'e-mail notification queue and reminder record (migration 14 applied?)', 'true',
    (select (exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'notifications' and column_name = 'email_claimed_at')
         and to_regprocedure('public.svc_claim_notification_emails(integer)') is not null
         and not has_function_privilege('authenticated', 'public.svc_claim_notification_emails(integer)', 'execute')
         and not has_function_privilege('authenticated', 'public.svc_finish_notification_email(uuid, boolean, text)', 'execute')
         and (select pg_get_functiondef(p.oid) like '%|customer)%'
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'record_staff_event'))::text)
  union all
  -- 20261020000100_staff_mfa.sql: staff permissions only in a session with two-factor authentication; authentication reset record.
  select 34, 'staff permissions require two-factor authentication (migration 15 applied?)', 'true',
    (select ((select pg_get_functiondef(p.oid) like '%aal2%'
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname = 'is_staff')
         and to_regprocedure('public.svc_record_staff_security_event(uuid, text, uuid)') is not null
         and not has_function_privilege('authenticated', 'public.svc_record_staff_security_event(uuid, text, uuid)', 'execute'))::text)
  union all
  -- 20261020000200_retention.sql: retention period for closed applications (nothing is deleted while the setting is empty).
  select 35, 'retention setting and automatic deletion functions (migration 16 applied?)', 'true',
    (select (exists (select 1 from public.settings where key = 'retention.closed_months' and visibility = 'staff')
         and to_regprocedure('public.svc_expired_applications(integer)') is not null
         and to_regprocedure('public.svc_delete_expired_application(uuid)') is not null
         and not has_function_privilege('authenticated', 'public.svc_delete_expired_application(uuid)', 'execute')
         and not has_function_privilege('authenticated', 'public.svc_expired_applications(integer)', 'execute'))::text)
  union all
  -- 20261020000300_form_requests_maps.sql: form edit request, "Formu düzenlemeyi tamamladım", map link,
  -- Fee step mark and a public "brand" bucket for the logo only.
  select 36, 'form edit request, map link and e-mail logo bucket (migration 17 applied?)', 'true',
    (select ((select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'applications'
                and column_name in ('fee_step_seen_at', 'form_edit_requested_at', 'form_edit_request_note', 'appointment_maps_url')) = 4
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'appointment_locations' and column_name = 'maps_url')
         and to_regprocedure('public.svc_request_form_edit(uuid, uuid, text)') is not null
         and to_regprocedure('public.svc_finish_form_correction(uuid, uuid)') is not null
         and not has_function_privilege('authenticated', 'public.svc_request_form_edit(uuid, uuid, text)', 'execute')
         and not has_function_privilege('authenticated', 'public.svc_finish_form_correction(uuid, uuid)', 'execute')
         and (select public and allowed_mime_types = array['image/png'] from storage.buckets where id = 'brand'))::text)
  union all
  -- 20261020000400_staff_admin.sql: staff admin; invitation, access and authentication reset are admin-only.
  select 37, 'staff admin (migration 18 applied?)', 'true',
    (select (exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_admin')
         and to_regprocedure('public.svc_set_staff_admin(uuid, uuid, boolean)') is not null
         and not has_function_privilege('authenticated', 'public.svc_set_staff_admin(uuid, uuid, boolean)', 'execute')
         and (select pg_get_functiondef(p.oid) like '%admin_required%'
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'svc_set_staff_access'))::text)
  union all
  -- 20261020000500_appointment_completion.sql: "Randevu gerçekleşti" once the appointment time has passed (the app calls it too).
  select 38, 'appointment marked as taken place once its time passes (migration 19 applied?)', 'true',
    (select (to_regprocedure('public.svc_complete_past_appointments()') is not null
         and not has_function_privilege('authenticated', 'public.svc_complete_past_appointments()', 'execute')
         and (select pg_get_functiondef(p.oid) like '%appointment_at <= now()%'
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname = 'complete_past_appointments'))::text)
  union all
  -- 20261020000600_document_rules_order_preferences.sql: document rules by type combination, order of appointment locations,
  -- 1–3 appointment preferences.
  select 39, 'document rules and ordering (migration 20 applied?)', 'true',
    (select (to_regclass('public.document_rules') is not null
         and to_regclass('public.document_rule_items') is not null
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'appointment_locations' and column_name = 'sort_order')
         and (select pg_get_functiondef(p.oid) like '%application_required_documents%'
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'sync_application_documents'))::text)
  union all
  -- 20261021000100_staff_delete.sql: staff deletion; the name of deleted staff in past records.
  select 40, 'staff deletion (migration 21 applied?)', 'true',
    (select (exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'audit_log' and column_name = 'actor_label')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'staff_notes' and column_name = 'author_label')
         and to_regprocedure('public.svc_delete_staff(uuid, uuid)') is not null)::text)
  union all
  -- 20261023000100_form_edit_note_optional.sql: the note on a form edit request is optional.
  select 41, 'note optional on form edit requests (migration 22 applied?)', 'true',
    (select (pg_get_functiondef(p.oid) like '%nullif(v_note, '''')%'
         and not has_function_privilege('authenticated', p.oid, 'execute'))::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'svc_request_form_edit')
  union all
  -- 20261023000200_staff_recovery_code.sql: two-factor authentication recovery code (only its digest is stored).
  select 42, 'two-factor authentication recovery code (migration 23 applied?)', 'true',
    (select (to_regclass('private.staff_recovery_codes') is not null
         and (select c.relrowsecurity from pg_class c where c.oid = to_regclass('private.staff_recovery_codes'))
         and not has_table_privilege('authenticated', 'private.staff_recovery_codes', 'SELECT')
         and to_regprocedure('public.svc_use_staff_recovery_code(uuid, text)') is not null
         and not has_function_privilege('authenticated', 'public.svc_use_staff_recovery_code(uuid, text)', 'execute')
         and not has_function_privilege('authenticated', 'public.svc_set_staff_recovery_code(uuid, text)', 'execute'))::text)
  union all
  -- 20261023000300_application_terms.sql: acceptance of the application terms of service (a draft without acceptance cannot be submitted).
  select 43, 'acceptance of the application terms of service (migration 24 applied?)', 'true',
    (select (to_regclass('public.application_terms_acceptances') is not null
         and not has_table_privilege('authenticated', 'public.application_terms_acceptances', 'INSERT')
         and to_regprocedure('public.svc_accept_application_terms(uuid, uuid, text)') is not null
         and not has_function_privilege('authenticated', 'public.svc_accept_application_terms(uuid, uuid, text)', 'execute')
         and exists (select 1 from pg_trigger where tgname = 'applications_require_terms'))::text)
  union all
  -- 20261023000400_appointment_letter.sql: appointment letter file type.
  select 44, 'appointment letter file type (migration 25 applied?)', 'true',
    (select (pg_get_constraintdef(c.oid) like '%appointment_letter%')::text
     from pg_constraint c where c.conname = 'application_files_kind_check')
  union all
  -- 20261026000100_optional_documents_extra_uploads.sql: the "Koşullu" (conditional) rule removed; extra documents after submission (limited).
  select 45, '“conditional” rule removed, extra document limit (migration 26 applied?)', 'true',
    (select ((select count(*) from public.document_rule_items where requirement = 'conditional') = 0
         and (select count(*) from public.application_documents where requirement = 'conditional') = 0
         and (select pg_get_constraintdef(c.oid) like '%extra_document%' from pg_constraint c where c.conname = 'application_files_kind_check')
         and exists (select 1 from public.settings where key = 'documents.extra_max' and visibility = 'customer')
         and exists (select 1 from pg_trigger where tgname = 'application_files_extra_guard')
         and to_regprocedure('public.svc_set_document_not_applicable(uuid, uuid, boolean, text)') is null)::text)
  union all
  -- 20261027000100_staff_delete_application.sql: an admin deleting an application (called only with the service role).
  select 46, 'admin application deletion (migration 27 applied?)', 'true',
    (select (to_regprocedure('public.svc_delete_application(uuid, uuid)') is not null
         and not has_function_privilege('authenticated', 'public.svc_delete_application(uuid, uuid)', 'execute')
         and not has_function_privilege('anon', 'public.svc_delete_application(uuid, uuid)', 'execute'))::text)
)
select no, check_name, expected, coalesce(actual, '(not found)') as actual,
       case when expected = actual then 'OK' else 'MISMATCH' end as status
from checks
order by no;
