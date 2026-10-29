import "server-only";
import { after } from "next/server";
import { appointmentMapsLink, appointmentParts } from "@/features/appointments/calendar";
import { notificationLink } from "@/features/notifications/page";
import { ROUTES, SITE } from "@/lib/site";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { logError, logWarning } from "../log";
import { EMAIL_LOGO_CID, emailDetail, isEmailConfigured, sendEmail } from "./mailer";
import { renderNotificationEmail, type EmailAppointment } from "./templates";

/**
 * SENDING NOTIFICATION E-MAILS (database migration 14)
 *
 * Every server action that creates a notification drains the queue after the response is sent (after); so the consultant
 * never waits after pressing a button. E-mails that could not be sent (temporary SMTP error) are retried by a scheduled job
 * that calls /api/email/send regularly (at most 5 times, for at most 2 days).
 *
 * The queue is only read with the service role (svc_claim_notification_emails). It takes no input from outside: the record
 * in the database decides which notification goes to whom. No e-mail address or content is logged.
 */

type Claimed = {
  id: string;
  kind: string;
  title: string;
  body: string;
  application_id: string | null;
  email: string | null;
  first_name: string | null;
  reference_code: string | null;
};

/** Notification types that show the appointment box. */
const APPOINTMENT_KINDS = new Set(["appointment.scheduled", "appointment.updated"]);

/**
 * The application's current appointment for the appointment box in the e-mail (at send time; service role, no extra
 * authorization check needed since the queued record is the application's own notification). null if there is no appointment or it cannot be read.
 */
async function loadEmailAppointment(admin: ReturnType<typeof createAdminClient>, applicationId: string): Promise<EmailAppointment | null> {
  const { data, error } = await admin
    .from("applications")
    .select("appointment_at, appointment_location, appointment_address, appointment_maps_url, appointment_note")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) {
    logError("email.appointment", error);
    return null;
  }
  const at = typeof data?.appointment_at === "string" ? data.appointment_at : null;
  const parts = at ? appointmentParts(at) : null;
  if (!parts) return null;
  // Appointment letter (migration 25): the e-mail only says it was attached. If it cannot be read the sentence is omitted (the appointment details still go out).
  const letter = await admin
    .from("application_files")
    .select("id")
    .eq("application_id", applicationId)
    .eq("kind", "appointment_letter")
    .eq("status", "ready")
    .limit(1);
  if (letter.error) logError("email.appointment_letter", letter.error);
  const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
  return {
    month: parts.month,
    day: parts.day,
    year: parts.year,
    longDate: parts.longDate,
    time: parts.time,
    place: text(data?.appointment_location),
    address: text(data?.appointment_address),
    mapsUrl: appointmentMapsLink(text(data?.appointment_maps_url)),
    note: text(data?.appointment_note),
    hasLetter: (letter.data ?? []).length > 0,
  };
}

const BATCH = 20;
const MAX_BATCHES = 5;

export type DeliveryResult = { configured: boolean; sent: number; failed: number };

/** Short description of an SMTP error that can be written to the log and the database (contains no address or content). */
function describeSmtpError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const e = error as { code?: unknown; responseCode?: unknown; command?: unknown };
  return [typeof e.code === "string" ? e.code : null, typeof e.responseCode === "number" ? String(e.responseCode) : null, typeof e.command === "string" ? e.command : null]
    .filter(Boolean)
    .join(" ")
    .slice(0, 120) || "unknown";
}

export async function deliverPendingEmails(): Promise<DeliveryResult> {
  if (!isEmailConfigured() || !isAdminClientConfigured()) return { configured: false, sent: 0, failed: 0 };
  const admin = createAdminClient();
  const siteUrl = getSiteUrl();
  const detail = emailDetail();
  let sent = 0;
  let failed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await admin.rpc("svc_claim_notification_emails", { p_limit: BATCH });
    if (error) {
      // Without migration 14 the function does not exist; notifications still show in the panel.
      if (error.code === "PGRST202" || error.code === "42883") logWarning("email.queue_missing");
      else logError("email.claim", error);
      break;
    }
    const rows = (data ?? []) as Claimed[];
    for (const row of rows) {
      let outcome: { sent: true } | { sent: false; reason: string };
      if (!row.email) outcome = { sent: false, reason: "no_address" };
      else {
        const link = row.application_id
          ? notificationLink(row.kind, row.application_id)
          : { label: "Bildirimlere git", href: ROUTES.customerNotifications };
        const appointment = row.application_id && APPOINTMENT_KINDS.has(row.kind) ? await loadEmailAppointment(admin, row.application_id) : null;
        const message = renderNotificationEmail({
          kind: row.kind,
          title: row.title,
          body: row.body,
          firstName: row.first_name,
          referenceCode: row.reference_code,
          link: `${siteUrl}${link.href}`,
          linkLabel: row.kind === "application.submitted" ? "Başvuruya git" : link.label,
          detail,
          companyName: SITE.companyName,
          siteUrl,
          logoSrc: `cid:${EMAIL_LOGO_CID}`,
          appointment,
        });
        try {
          await sendEmail(row.email, message);
          outcome = { sent: true };
        } catch (sendError) {
          outcome = { sent: false, reason: describeSmtpError(sendError) };
        }
      }
      if (outcome.sent) sent += 1;
      else {
        failed += 1;
        logWarning("email.send_failed", { kind: row.kind, reason: outcome.reason });
      }
      const { error: finishError } = await admin.rpc("svc_finish_notification_email", {
        p_id: row.id,
        p_sent: outcome.sent,
        p_error: outcome.sent ? null : outcome.reason,
      });
      if (finishError) logError("email.finish", finishError);
    }
    if (rows.length < BATCH) break;
  }
  return { configured: true, sent, failed };
}

/** Sends pending e-mails after the response is sent (in server actions, after a notification is created). */
export function scheduleEmailDelivery(): void {
  if (!isEmailConfigured()) return;
  after(async () => {
    try {
      await deliverPendingEmails();
    } catch (error) {
      logError("email.deliver", error);
    }
  });
}
