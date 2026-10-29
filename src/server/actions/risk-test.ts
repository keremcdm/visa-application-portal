"use server";

import { revalidatePath } from "next/cache";
import { RISK_TEST_VERSION } from "@/features/risk-test/definition";
import { normalizeRiskAnswers } from "@/features/risk-test/scoring";
import { ROUTES } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "../auth";
import { logError } from "../log";
import { fail, NOT_CONFIGURED_ERROR, ok, SESSION_EXPIRED_ERROR, type ActionResult } from "../result";

/**
 * Saves the risk assessment answers to the user's own account (one record per user;
 * retaking the test overwrites the previous answers).
 *
 * The result is not stored: the eligibility band is recomputed from the answers every time it is shown.
 * The write uses the user's own session; RLS prevents saving on someone else's behalf.
 */
export async function saveRiskAssessmentAction(rawAnswers: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);
  const user = await getCurrentUser();
  if (!user) return fail(SESSION_EXPIRED_ERROR);

  // Data from the client is untrusted: every question must be answered with a valid option.
  const answers = normalizeRiskAnswers(rawAnswers);
  if (!answers) return fail("Cevaplarınız eksik veya geçersiz. Lütfen tüm soruları yanıtlayınız.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("risk_assessments")
    .upsert({ user_id: user.id, version: RISK_TEST_VERSION, answers, completed_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    logError("risk_test.save", error);
    return fail("Cevaplarınız kaydedilemedi. İnternet bağlantınızı kontrol edip tekrar deneyiniz.");
  }

  revalidatePath(ROUTES.customer, "layout");
  return ok();
}
