import type { VisaOutcome } from "@/lib/domain/constants";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { ADMIN_STATES, DETAIL_STAGE_NAMES, type AdminOwner, type AdminStateKey } from "./admin-state";

/**
 * ADMIN — APPLICATION DETAIL, "GENEL" (GENERAL) TAB
 * Texts and buttons of the "Sıradaki iş" (next task) card, the 6-step stage line and the summaries of the section rows.
 * Texts come from `N`, `STAGE_MAP` and the section summaries in the design; dates and numbers come from real data.
 * The "Ödeme bekleniyor" state (the customer has not reported the payment yet), which is not in the design, is written in the same style.
 */

/** The cancellation reason is written to the internal notes starting with this text; the application page reads the latest reason from there. */
/**
 * The "Yapan" (by) column in the history. For an action done by a person their name (or e-mail) is shown. Entries nobody
 * made are changes the rule made by itself (e.g. the application returning to review once the customer uploads the requested
 * document, "Randevu gerçekleşti" once the appointment time has passed): these show "Otomatik" (automatic); if a person did
 * something at the same time (within 2 minutes) it is noted that it followed that action. These entries used to show "Sistem".
 */
export function auditActorTexts(entries: readonly { id: number; actorName: string | null; createdAt: string }[]): Map<number, string> {
  const WINDOW_MS = 2 * 60 * 1000;
  const time = (iso: string) => new Date(iso).getTime();
  const result = new Map<number, string>();
  entries.forEach((entry, index) => {
    if (entry.actorName) {
      result.set(entry.id, entry.actorName);
      return;
    }
    const at = time(entry.createdAt);
    let best: { name: string; distance: number } | null = null;
    for (let i = 0; i < entries.length; i++) {
      const other = entries[i]!;
      if (i === index || !other.actorName) continue;
      if (Math.abs(time(other.createdAt) - at) > WINDOW_MS) continue;
      const distance = Math.abs(i - index);
      if (!best || distance < best.distance) best = { name: other.actorName, distance };
    }
    result.set(entry.id, best ? `Otomatik (${best.name} işleminin ardından)` : "Otomatik");
  });
  return result;
}

/**
 * "Yapan" text for an action by staff in the history: "(Admin)" next to the name.
 */
export function staffActorText(name: string): string {
  return `${name} (Admin)`;
}

export const CANCEL_REASON_PREFIX = "İptal gerekçesi: ";

export type DetailAction =
  | "remind"
  | "verifyPayment"
  | "rejectPayment"
  | "documentsComplete"
  | "undoComplete"
  | "requestCorrections"
  | "scheduleAppointment"
  | "reportResult"
  | "reopen";

export type NextStepView = {
  owner: AdminOwner;
  title: string;
  desc: string;
  primary: DetailAction | null;
  secondary: DetailAction[];
  /** Notification note with a bell icon ("İki eylemde de müşteriye bildirim gider."); empty if none. */
  notify: string;
  /** Info shown in a prominent box under the description (e.g. cancellation reason); absent if none. */
  highlight?: { label: string; text: string };
};

export type DetailFacts = {
  key: AdminStateKey;
  /** Number of missing items (documents + tasks + form) in the "Müşteriden işlem bekleniyor" state. */
  missingCount: number;
  appointment: { at: string | null; location: string | null };
  visaOutcome: { outcome: VisaOutcome; at: string } | null;
  cancel: { at: string | null; by: string | null; reason: string | null };
};

/** "19.11.2026" (Istanbul time). */
export function shortDate(iso: string | null): string {
  return iso ? formatDateTimeTr(iso).slice(0, 10) : "";
}

/** "19.11.2026 09:30" (Istanbul time). */
export function shortDateTimeText(iso: string | null): string {
  return iso ? formatDateTimeTr(iso) : "";
}

export function nextStep(f: DetailFacts): NextStepView {
  const owner = ADMIN_STATES[f.key].owner;
  const remind = { primary: "remind" as const, secondary: [] as DetailAction[], notify: "Hatırlatma müşteriye gider." };
  switch (f.key) {
    case "draft":
      return { owner, title: "Müşterinin formu göndermesi bekleniyor", desc: "Form gönderilince başvuru ödeme kontrolüne geçer.", ...remind };
    case "awaitingPayment":
      return {
        owner,
        title: "Müşterinin ödemeyi bildirmesi bekleniyor",
        desc: "Müşteri ödemeyi yapıp “Ödemeyi yaptım” ile bildirince başvuru ödeme kontrolüne geçer. Tutar hesaba geçtiyse ödemeyi bildirim beklemeden doğrulayabilirsiniz.",
        primary: "remind",
        secondary: ["verifyPayment"],
        notify: "Hatırlatma da doğrulama da müşteriye bildirim olarak gider.",
      };
    case "a":
      return {
        owner,
        title: "Ödemeyi doğrulayın",
        desc: "Doğrulayınca başvuru inceleme aşamasına geçer. Reddederseniz müşteri yeni dekont yükler.",
        primary: "verifyPayment",
        secondary: ["rejectPayment"],
        notify: "İki eylemde de müşteriye bildirim gider.",
      };
    case "payRejected":
      return {
        owner,
        title: "Müşterinin yeni dekont yüklemesi bekleniyor",
        desc: "Yeni dekont gelince başvuru yeniden ödeme kontrolüne düşer.",
        primary: "remind",
        secondary: ["verifyPayment"],
        notify: "Hatırlatma müşteriye gider.",
      };
    case "b":
      return {
        owner,
        title: "Formu ve belgeleri inceleyin",
        desc: "Her şey tamamsa randevu aşamasına geçin. Eksik varsa müşteriden isteyin; başvuru müşteriye geçer.",
        primary: "documentsComplete",
        secondary: ["requestCorrections"],
        notify: "İki eylemde de müşteriye bildirim gider.",
      };
    case "c":
      return {
        owner,
        title: f.missingCount > 0 ? `Müşterinin ${f.missingCount} eksiği tamamlaması bekleniyor` : "Tüm eksikler tamamlandı",
        desc: "Tüm eksikler tamamlanınca başvuru kendiliğinden incelemeye döner.",
        ...remind,
      };
    case "d":
      return {
        owner,
        title: "Randevu tarihini bildirin",
        desc: "Bildirince müşteriye randevu bilgisi gider; başvuru randevu saatine kadar kendiliğinden bekler.",
        primary: "scheduleAppointment",
        // If "Evraklar tamamlandı" was marked by mistake, undoing it is available here too.
        secondary: ["undoComplete"],
        notify: "Müşteriye bildirim gider.",
      };
    case "d2": {
      const where = [shortDateTimeText(f.appointment.at), f.appointment.location].filter(Boolean).join(" · ");
      return {
        owner,
        title: "Randevu günü bekleniyor",
        desc: `${where ? `${where}. ` : ""}Randevu saati geçince başvuru kendiliğinden “Sonuç bekleniyor”a geçer.`,
        primary: null,
        secondary: [],
        notify: "",
      };
    }
    case "f":
      return {
        owner,
        title: "Vize sonucunu bildirin",
        desc: `${f.appointment.at ? `Randevu ${shortDate(f.appointment.at)}’de gerçekleşti. ` : ""}Sonuç bildirilince başvuru kapanır ve müşteri sonucu panelinde görür.`,
        primary: "reportResult",
        secondary: [],
        notify: "Müşteriye bildirim gider; öncesinde onay istenir.",
      };
    case "g":
      return {
        owner,
        title: f.visaOutcome?.outcome === "refused" ? "Başvuru sonuçlandı · Vize reddedildi" : "Başvuru sonuçlandı · Vize onaylandı",
        desc: f.visaOutcome ? `Sonuç ${shortDateTimeText(f.visaOutcome.at)}’de müşteriye bildirildi.` : "Sonuç müşteriye bildirildi.",
        primary: null,
        secondary: [],
        notify: "",
      };
    case "h": {
      const parts = [shortDateTimeText(f.cancel.at), f.cancel.by].filter(Boolean);
      return {
        owner,
        title: "Başvuru iptal edildi",
        desc: `${parts.length > 0 ? `${parts.join(" · ")}. ` : ""}Müşteri yalnızca mesajları görür. İptali geri alırsanız başvuru iptalden önceki aşamasına döner.`,
        primary: "reopen",
        secondary: [],
        notify: "Müşteriye bildirim gider.",
        // The reason is shown separately and prominently.
        ...(f.cancel.reason ? { highlight: { label: "İptal gerekçesi", text: f.cancel.reason } } : {}),
      };
    }
  }
}

// --- Stage line ----------------------------------------------------------------------------------------------

export type DetailStageState = "done" | "current" | "customer" | "waiting" | "skipped" | "cancelled";
export type DetailStage = { name: string; state: DetailStageState; sub: string };

export type StageFacts = {
  key: AdminStateKey;
  paymentVerifiedAt: string | null;
  /** The last moment it was marked "Evraklar tamamlandı". */
  documentsCompleteAt: string | null;
  /** Was the extra documents / customer action stage opened; if so, when did it last close. */
  extraRequested: boolean;
  extraClosedAt: string | null;
  appointmentAt: string | null;
  visaOutcome: { outcome: VisaOutcome; at: string } | null;
  /** Stage (0–5) and moment of cancellation. */
  cancelledStage: number;
  cancelledAt: string | null;
};

const W: [DetailStageState, string] = ["waiting", "Bekliyor"];
const G: [DetailStageState, string] = ["waiting", "Gerekirse"];

export function detailStages(f: StageFacts): DetailStage[] {
  const done = (iso: string | null, fallback = "Tamamlandı"): [DetailStageState, string] => ["done", shortDate(iso) || fallback];
  const extra: [DetailStageState, string] = f.extraRequested ? done(f.extraClosedAt) : ["skipped", "Gerekmedi"];
  const pay = done(f.paymentVerifiedAt);
  const review = done(f.documentsCompleteAt);
  let states: [DetailStageState, string][];
  switch (f.key) {
    case "draft":
      states = [["customer", "Form bekleniyor"], W, G, W, W, W];
      break;
    case "awaitingPayment":
      states = [["customer", "Ödeme bekleniyor"], W, G, W, W, W];
      break;
    case "a":
      states = [["current", "Ödeme kontrolü"], W, G, W, W, W];
      break;
    case "payRejected":
      states = [["customer", "Yeni dekont bekleniyor"], W, G, W, W, W];
      break;
    case "b":
      states = [pay, ["current", "Şu an"], G, W, W, W];
      break;
    case "c":
      // First review done and missing items requested from the customer (same as the list bar: review shown as complete).
      states = [pay, ["done", "Ön inceleme yapıldı"], ["customer", "Müşteride"], W, W, W];
      break;
    case "d":
      states = [pay, review, extra, ["current", "Bildirilecek"], W, W];
      break;
    case "d2":
      states = [pay, review, extra, ["current", "Gün bekleniyor"], W, W];
      break;
    case "f":
      states = [pay, review, extra, done(f.appointmentAt), ["current", "Şu an"], W];
      break;
    case "g":
      states = [
        pay,
        review,
        extra,
        done(f.appointmentAt),
        done(f.visaOutcome?.at ?? null),
        ["done", f.visaOutcome?.outcome === "refused" ? "Reddedildi" : f.visaOutcome ? "Onaylandı" : "Tamamlandı"],
      ];
      break;
    case "h": {
      const stage = Math.min(Math.max(f.cancelledStage, 0), 5);
      const before: [DetailStageState, string][] = [pay, review, extra, done(f.appointmentAt), done(null), done(null)];
      states = before.map((value, i) =>
        i < stage ? value : i === stage ? ["cancelled", `İptal${f.cancelledAt ? ` · ${shortDate(f.cancelledAt)}` : ""}`] : ["waiting", "—"],
      );
      break;
    }
  }
  return states.map(([state, sub], i) => ({ name: DETAIL_STAGE_NAMES[i]!, state, sub }));
}
