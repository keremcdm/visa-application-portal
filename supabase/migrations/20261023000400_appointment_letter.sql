-- =============================================================================
-- Migration 25: appointment letter
-- =============================================================================
-- when sending the appointment date the consultant can also upload the appointment letter;
-- the customer can view and download it from the appointment card.
--
-- The letter is stored as a separate file type in the application's private folder ("appointment_letter"). Sessions cannot
-- write file records (only the service role, after the app verifies the staff member's identity); the customer reads the files
-- of their own application (existing policy). When a new letter is uploaded the app deletes the old one.
--
-- DATA: no row is deleted or changed; only the file type constraint is widened. It can be run a second time.

alter table public.application_files drop constraint application_files_kind_check;
alter table public.application_files add constraint application_files_kind_check
  check (kind in ('document', 'payment_receipt', 'staff_attachment', 'visa_result', 'appointment_letter'));
