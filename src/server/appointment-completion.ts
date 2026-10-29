import "server-only";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { scheduleEmailDelivery } from "./email/deliver";
import { logError, logWarning } from "./log";

/**
 * "RANDEVU GERÇEKLEŞTİ" ONCE THE APPOINTMENT TIME HAS PASSED
 *
 * Sent appointments whose time has passed are set to "Randevu gerçekleşti" (appointment took place) in the database; the
 * application moves to "Sonuç bekleniyor" (awaiting result) by itself and the customer is notified (migration 19,
 * svc_complete_past_appointments). This is not left to the scheduled job in Supabase: it runs when admin and customer pages
 * open, right before page data is read, at most once a minute. It reads and returns no personal data; it is only called from authenticated requests.
 */

const INTERVAL_MS = 60 * 1000;
let lastRun = 0;

export async function completePastAppointments(): Promise<void> {
  if (!isAdminClientConfigured()) return;
  const now = Date.now();
  if (now - lastRun < INTERVAL_MS) return;
  lastRun = now;
  try {
    const { data, error } = await createAdminClient().rpc("svc_complete_past_appointments");
    if (error) {
      // Without migration 19 the function does not exist; appointments move on through the scheduled job if one is set up.
      if (error.code === "PGRST202") logWarning("appointments.complete.migration_missing");
      else logError("appointments.complete", error);
      return;
    }
    // E-mails for the "Randevunuz gerçekleşti" notifications are sent.
    if (typeof data === "number" && data > 0) scheduleEmailDelivery();
  } catch (error) {
    logError("appointments.complete", error);
  }
}
