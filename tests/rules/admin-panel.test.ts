import { describe, expect, it } from "vitest";
import { detailStages, nextStep, type DetailFacts, type StageFacts } from "@/features/staff/admin-detail";
import { auditActorTexts, staffActorText } from "@/features/staff/admin-detail";
import { appointmentCell, documentsCell, isArchived, paymentCell, type ListRowFacts } from "@/features/staff/admin-list";
import { ADMIN_STATES, adminStateKey, LIST_TABS, listSegments, relativeTime, stageOfStatus, turnOf, type AdminStateKey } from "@/features/staff/admin-state";
import { APPLICATION_STATUSES } from "@/lib/domain/constants";

/** Admin panel: status mapping, list cells, next task and stage line. */

const ALL_KEYS = Object.keys(ADMIN_STATES) as AdminStateKey[];

describe("status key", () => {
  it("every status of the app maps to a key from the design", () => {
    for (const status of APPLICATION_STATUSES) {
      expect(ALL_KEYS).toContain(adminStateKey({ status, paymentStatus: "verified", appointmentStatus: "not_started" }));
    }
  });

  it("for a submitted application the payment status is split: pending, being checked, refused", () => {
    const key = (paymentStatus: "awaiting_payment" | "under_review" | "rejected") => adminStateKey({ status: "submitted", paymentStatus, appointmentStatus: "not_started" });
    expect(key("awaiting_payment")).toBe("awaitingPayment");
    expect(key("under_review")).toBe("a");
    expect(key("rejected")).toBe("payRejected");
  });

  it("if the appointment was sent after documents were complete: 'Randevu bildirildi' (waits by itself)", () => {
    expect(adminStateKey({ status: "documents_complete", paymentStatus: "verified", appointmentStatus: "scheduled" })).toBe("d2");
    expect(adminStateKey({ status: "documents_complete", paymentStatus: "verified", appointmentStatus: "preferences_submitted" })).toBe("d");
    expect(turnOf("d2")).toEqual({ label: "Otomatik bekliyor", kind: "auto" });
  });

  it("tabs as in the design: on us = a, b, d, f · with customer = draft, payment pending/refused, c · closed = g, h", () => {
    const byOwner = (owner: string | null) => ALL_KEYS.filter((k) => owner === null || ADMIN_STATES[k].owner === owner).sort();
    const tab = (id: string) => LIST_TABS.find((t) => t.id === id)!.owner;
    expect(byOwner(tab("ours"))).toEqual(["a", "b", "d", "f"]);
    expect(byOwner(tab("customer"))).toEqual(["awaitingPayment", "c", "draft", "payRejected"]);
    expect(byOwner(tab("appointment"))).toEqual(["d2"]);
    expect(byOwner(tab("closed"))).toEqual(["g", "h"]);
  });
});

describe("list row", () => {
  it("stage bar: 'skipped' if extra documents were never requested, 'done' if they were", () => {
    expect(listSegments("d", false)).toEqual(["D", "D", "S", "x", "W", "W"]);
    expect(listSegments("f", true)).toEqual(["D", "D", "D", "D", "x", "W"]);
    // When missing items are requested from the customer the review counts as done: with "3/6" the 2nd segment is not grey.
    expect(listSegments("c", true)).toEqual(["D", "D", "c", "W", "W", "W"]);
  });

  it("for a cancelled application the bar shows the stage where it was cancelled", () => {
    expect(listSegments("h", false, stageOfStatus("in_review"))).toEqual(["D", "X", "W", "W", "W", "W"]);
    expect(listSegments("h", true, stageOfStatus("documents_complete"))).toEqual(["D", "D", "D", "X", "W", "W"]);
    expect(listSegments("h", false, stageOfStatus("submitted"))).toEqual(["X", "W", "W", "W", "W", "W"]);
  });

  const facts = (key: AdminStateKey, extra: Partial<ListRowFacts> = {}): ListRowFacts => ({
    key,
    paymentStatus: "verified",
    receipts: 1,
    documents: { total: 12, approved: 10, outstanding: 0 },
    appointmentStatus: "preferences_submitted",
    appointmentAt: null,
    preferenceCount: 3,
    ...extra,
  });

  it("payment, document and appointment cells come from real counts; short labels, no meaningless second line", () => {
    expect(paymentCell(facts("a", { paymentStatus: "under_review" }))).toEqual({ label: "Kontrol ediliyor", tone: "navy", sub: "Dekont yüklendi" });
    expect(paymentCell(facts("b"))).toEqual({ label: "Doğrulandı", tone: "green", sub: "" });
    // Plain text instead of "—".
    expect(paymentCell(facts("draft", { paymentStatus: "not_due" }))).toEqual({ label: "Gönderilmedi", tone: "gray", sub: "" });
    expect(paymentCell(facts("h", { paymentStatus: "awaiting_payment" }))).toEqual({ label: "Doğrulanmadı", tone: "gray", sub: "" });
    expect(documentsCell(facts("b"))).toEqual({ label: "İnceleniyor", tone: "navy", sub: "10 / 12 onaylı" });
    expect(documentsCell(facts("c", { documents: { total: 12, approved: 9, outstanding: 2 } }))).toEqual({ label: "2 eksik", tone: "yellow", sub: "" });
    // The documents cell is empty before the payment is verified ("Bekliyor · Ödeme sonrası" is not written).
    expect(documentsCell(facts("a"))).toEqual({ label: "İncelenmedi", tone: "gray", sub: "Ödemeden sonra" });
    expect(documentsCell(facts("h"))).toEqual({ label: "İptal edildi", tone: "gray", sub: "" });
    expect(documentsCell(facts("draft"))).toEqual({ label: "Gönderilmedi", tone: "gray", sub: "" });
    expect(appointmentCell(facts("d"))).toEqual({ label: "Bildirilecek", tone: "navy", sub: "3 tercih" });
    expect(appointmentCell(facts("b"))).toEqual({ label: "Tercih alındı", tone: "gray", sub: "" });
    expect(appointmentCell(facts("b", { preferenceCount: 0 }))).toEqual({ label: "Tercih yok", tone: "gray", sub: "" });
    expect(appointmentCell(facts("h"))).toEqual({ label: "İptal edildi", tone: "gray", sub: "" });
    expect(appointmentCell(facts("d2", { appointmentStatus: "scheduled", appointmentAt: "2026-11-19T06:30:00Z" }))).toEqual({
      label: "Bildirildi",
      tone: "green",
      sub: "19 Kas 2026 · 09:30",
    });
  });

  it("the appointment date is only shown for a sent or completed appointment", () => {
    // Old test data may still have a date; if the status is "preference received" no date is written.
    expect(appointmentCell(facts("d", { appointmentStatus: "preferences_submitted", appointmentAt: "2026-11-19T06:30:00Z" }))?.sub).toBe("3 tercih");
  });

  it("closed applications leave the list after 7 days (visible with 'Tamamlananları göster')", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(isArchived("g", "2026-10-12T11:00:00Z", now)).toBe(true);
    expect(isArchived("h", "2026-10-12T11:00:00Z", now)).toBe(true);
    expect(isArchived("g", "2026-10-15T12:00:00Z", now)).toBe(false);
    expect(isArchived("f", "2026-01-01T00:00:00Z", now)).toBe(false);
  });

  it("update time: just now, hours, yesterday, days", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(relativeTime("2026-10-19T11:30:00Z", now)).toBe("Az önce");
    expect(relativeTime("2026-10-19T07:00:00Z", now)).toBe("5 saat önce");
    expect(relativeTime("2026-10-18T10:00:00Z", now)).toBe("Dün");
    expect(relativeTime("2026-10-15T10:00:00Z", now)).toBe("4 gün önce");
  });
});

describe("next task", () => {
  const facts = (key: AdminStateKey, extra: Partial<DetailFacts> = {}): DetailFacts => ({
    key,
    missingCount: 0,
    appointment: { at: null, location: null },
    visaOutcome: null,
    cancel: { at: null, by: null, reason: null },
    ...extra,
  });

  it("every status has an owner and the action from the design", () => {
    expect(nextStep(facts("a"))).toMatchObject({ owner: "us", title: "Ödemeyi doğrulayın", primary: "verifyPayment", secondary: ["rejectPayment"] });
    expect(nextStep(facts("b"))).toMatchObject({ owner: "us", primary: "documentsComplete", secondary: ["requestCorrections"] });
    expect(nextStep(facts("d"))).toMatchObject({ owner: "us", primary: "scheduleAppointment", secondary: ["undoComplete"] });
    expect(nextStep(facts("f"))).toMatchObject({ owner: "us", primary: "reportResult" });
    for (const key of ["draft", "awaitingPayment", "payRejected", "c"] as const) {
      expect(nextStep(facts(key))).toMatchObject({ owner: "customer", primary: "remind" });
    }
    expect(nextStep(facts("d2"))).toMatchObject({ owner: "auto", primary: null });
    expect(nextStep(facts("g"))).toMatchObject({ owner: "closed", primary: null });
  });

  it("with customer: number of missing items in the title; cancelled: who, when, reason and 'İptali geri al'", () => {
    expect(nextStep(facts("c", { missingCount: 3 })).title).toBe("Müşterinin 3 eksiği tamamlaması bekleniyor");
    expect(nextStep(facts("c")).title).toBe("Tüm eksikler tamamlandı");
    const cancelled = nextStep(facts("h", { cancel: { at: "2026-10-17T08:40:00Z", by: "Test Personel", reason: "TEST vazgeçti" } }));
    expect(cancelled.desc).toContain("17.10.2026 11:40 · Test Personel.");
    expect(cancelled.highlight).toEqual({ label: "İptal gerekçesi", text: "TEST vazgeçti" });
    expect(cancelled.primary).toBe("reopen");
  });

  it("result sent: approved / refused title", () => {
    expect(nextStep(facts("g", { visaOutcome: { outcome: "refused", at: "2026-12-03T11:20:00Z" } })).title).toBe("Başvuru sonuçlandı · Vize reddedildi");
    expect(nextStep(facts("g", { visaOutcome: { outcome: "approved", at: "2026-12-03T11:20:00Z" } })).title).toBe("Başvuru sonuçlandı · Vize onaylandı");
  });
});

describe("stage line", () => {
  const base: StageFacts = {
    key: "b",
    paymentVerifiedAt: "2026-10-16T01:56:00Z",
    documentsCompleteAt: null,
    extraRequested: false,
    extraClosedAt: null,
    appointmentAt: null,
    visaOutcome: null,
    cancelledStage: 0,
    cancelledAt: null,
  };

  it("with customer: the initial review shows as done, extra documents with the customer", () => {
    const stages = detailStages({ ...base, key: "c" });
    expect(stages.slice(0, 3).map((s) => [s.state, s.sub])).toEqual([
      ["done", "16.10.2026"],
      ["done", "Ön inceleme yapıldı"],
      ["customer", "Müşteride"],
    ]);
  });

  it("review: payment done (with date), review current, extra documents 'Gerekirse' (if needed)", () => {
    expect(detailStages(base).map((s) => [s.state, s.sub])).toEqual([
      ["done", "16.10.2026"],
      ["current", "Şu an"],
      ["waiting", "Gerekirse"],
      ["waiting", "Bekliyor"],
      ["waiting", "Bekliyor"],
      ["waiting", "Bekliyor"],
    ]);
  });

  it("concluded: 'Gerekmedi' (not needed) if no extra documents were requested, the result on the last step", () => {
    const stages = detailStages({
      ...base,
      key: "g",
      documentsCompleteAt: "2026-10-17T09:00:00Z",
      appointmentAt: "2026-11-19T06:30:00Z",
      visaOutcome: { outcome: "approved", at: "2026-12-03T11:20:00Z" },
    });
    expect(stages.map((s) => [s.state, s.sub])).toEqual([
      ["done", "16.10.2026"],
      ["done", "17.10.2026"],
      ["skipped", "Gerekmedi"],
      ["done", "19.11.2026"],
      ["done", "03.12.2026"],
      ["done", "Onaylandı"],
    ]);
  });

  it("cancelled: the stage where it was cancelled with a cross, nothing after it", () => {
    const stages = detailStages({ ...base, key: "h", cancelledStage: 1, cancelledAt: "2026-10-17T08:40:00Z" });
    expect(stages.map((s) => s.state)).toEqual(["done", "cancelled", "waiting", "waiting", "waiting", "waiting"]);
    expect(stages[1]!.sub).toBe("İptal · 17.10.2026");
    expect(stages[2]!.sub).toBe("—");
  });
});

describe("audit log — actor", () => {
  it("a person's action shows their name; a change the rule made by itself shows 'Otomatik' and the owner of the recent action", () => {
    const texts = auditActorTexts([
      { id: 3, actorName: null, createdAt: "2026-10-20T10:00:00Z" },
      { id: 2, actorName: "Deneme Müşteri", createdAt: "2026-10-20T10:00:00Z" },
      { id: 1, actorName: null, createdAt: "2026-10-18T09:00:00Z" },
    ]);
    expect(texts.get(2)).toBe("Deneme Müşteri");
    expect(texts.get(3)).toBe("Otomatik (Deneme Müşteri işleminin ardından)");
    // An entry with no person's action nearby (e.g. the appointment day passed).
    expect(texts.get(1)).toBe("Otomatik");
  });

  it("an action by staff shows (Admin) next to the name", () => {
    expect(staffActorText("Ayşe Danışman")).toBe("Ayşe Danışman (Admin)");
  });
});
