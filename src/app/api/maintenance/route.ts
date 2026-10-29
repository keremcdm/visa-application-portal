import { NextResponse, type NextRequest } from "next/server";
import { completePastAppointments } from "@/server/appointment-completion";
import { cronAuthorized } from "@/server/cron";
import { deliverPendingEmails } from "@/server/email/deliver";
import { logError } from "@/server/log";
import { runRetentionCleanup } from "@/server/retention";

/**
 * Daily maintenance (for a scheduled job): marks past appointments as "took place", sends pending e-mails and deletes
 * closed applications whose retention period has expired
 * (if a period is set in Settings). Only runs with an "Authorization: Bearer <CRON_SECRET>" header; the response contains only counts.
 */
async function handle(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) return NextResponse.json({ message: "Bulunamadı." }, { status: 404 });
  try {
    await completePastAppointments();
    const [email, retention] = await Promise.all([deliverPendingEmails(), runRetentionCleanup()]);
    return NextResponse.json({ email, retention }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("maintenance.cron", error);
    return NextResponse.json({ message: "Bakım tamamlanamadı." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
