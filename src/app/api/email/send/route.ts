import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/server/cron";
import { deliverPendingEmails } from "@/server/email/deliver";
import { logError } from "@/server/log";

/**
 * Sends pending notification e-mails (for a scheduled job; e.g. every 10 minutes).
 * Only runs with an "Authorization: Bearer <CRON_SECRET>" header. The response contains only counts (no addresses or content).
 */
async function handle(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) return NextResponse.json({ message: "Bulunamadı." }, { status: 404 });
  try {
    const result = await deliverPendingEmails();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("email.cron", error);
    return NextResponse.json({ message: "E-postalar gönderilemedi." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
