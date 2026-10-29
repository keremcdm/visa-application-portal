import { describe, expect, it } from "vitest";
import { appointmentLeaf, monthGrid, monthsCovering } from "@/features/appointments/calendar";
import {
  addMonthsIso,
  alternativeDates,
  DEFAULT_APPOINTMENT_CONFIG,
  selectableDates,
  validateAlternativePreferences,
  validatePreferences,
} from "@/features/appointments/window";
import {
  filterNotifications,
  groupByDay,
  notificationCategory,
  notificationClock,
  notificationDay,
  notificationLink,
  notificationPendingAction,
  notificationRequiresAction,
} from "@/features/notifications/page";
import { weekdayOfIso } from "@/lib/validation/formats";

// Thursday.
const TODAY = "2026-10-15";

describe("appointment: none of these dates suit me", () => {
  it("the next 7 days and the following 10 working days are skipped; the working days after that are offered", () => {
    const dates = alternativeDates(TODAY, DEFAULT_APPOINTMENT_CONFIG);
    // 7 days: 16–22 October. The next 10 working days: 23, 26–30 October, 2–5 November. First offered day: Friday 6 November.
    expect(dates[0]).toBe("2026-11-06");
    // The calendar reaches up to three months from today.
    expect(dates.at(-1)).toBe("2027-01-15");
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
    expect(dates.every((d) => weekdayOfIso(d) >= 1 && weekdayOfIso(d) <= 5)).toBe(true);
    // Does not overlap with the normal preference window.
    const window = new Set(selectableDates(TODAY, DEFAULT_APPOINTMENT_CONFIG));
    expect(dates.some((d) => window.has(d))).toBe(false);
  });

  it("days excluded in Settings do not count as working days", () => {
    const config = { ...DEFAULT_APPOINTMENT_CONFIG, excludedDates: ["2026-10-29", "2026-11-06"] };
    const dates = alternativeDates(TODAY, config);
    // 29 October and 6 November do not count as working days: the 10 skipped working days end on 9 November, the first offered day is Tuesday 10 November.
    expect(dates[0]).toBe("2026-11-10");
    expect(dates).not.toContain("2026-11-06");
  });

  it("1–3 different days; all day, morning or afternoon for each", () => {
    const [a, b, c, d] = alternativeDates(TODAY, DEFAULT_APPOINTMENT_CONFIG);
    expect(validateAlternativePreferences([{ date: a, slot: "full_day" }], TODAY, DEFAULT_APPOINTMENT_CONFIG).ok).toBe(true);
    expect(
      validateAlternativePreferences(
        [
          { date: a, slot: "full_day" },
          { date: b, slot: "morning" },
          { date: c, slot: "evening" },
        ],
        TODAY,
        DEFAULT_APPOINTMENT_CONFIG,
      ).ok,
    ).toBe(true);
    expect(validateAlternativePreferences([], TODAY, DEFAULT_APPOINTMENT_CONFIG)).toMatchObject({ ok: false, message: expect.stringMatching(/en az bir gün/) });
    expect(
      validateAlternativePreferences(
        [a, b, c, d].map((date) => ({ date, slot: "morning" })),
        TODAY,
        DEFAULT_APPOINTMENT_CONFIG,
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/en fazla üç/i) });
    expect(
      validateAlternativePreferences(
        [
          { date: a, slot: "morning" },
          { date: a, slot: "evening" },
        ],
        TODAY,
        DEFAULT_APPOINTMENT_CONFIG,
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/Aynı günü/) });
    // A day from the normal window is not accepted as a "dates don't suit me" choice.
    const near = selectableDates(TODAY, DEFAULT_APPOINTMENT_CONFIG)[0]!;
    expect(validateAlternativePreferences([{ date: near, slot: "morning" }], TODAY, DEFAULT_APPOINTMENT_CONFIG).ok).toBe(false);
  });

  it("'Tüm gün' can also be picked for a normal preference", () => {
    const [x, y, z] = selectableDates(TODAY, DEFAULT_APPOINTMENT_CONFIG);
    const result = validatePreferences(
      [
        { date: x, slot: "full_day" },
        { date: y, slot: "morning" },
        { date: z, slot: "morning" },
      ],
      TODAY,
      DEFAULT_APPOINTMENT_CONFIG,
    );
    expect(result.ok).toBe(true);
  });
});

describe("randevu takvimi", () => {
  it("the month grid starts on Monday; cells outside the month are empty", () => {
    const november = monthGrid("2026-11");
    expect(november.label).toBe("Kasım 2026");
    // Sunday: the last cell of the first week.
    expect(november.weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(november.weeks.every((week) => week.length === 7)).toBe(true);
    expect(november.weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(november.weeks.at(-1)!.at(0)).toBe("2026-11-30");
  });

  it("every month covering the offered days is shown", () => {
    const dates = alternativeDates(TODAY, DEFAULT_APPOINTMENT_CONFIG);
    expect(monthsCovering(dates).map((m) => m.key)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(monthsCovering(["2026-12-30", "2027-01-04"]).map((m) => m.label)).toEqual(["Aralık 2026", "Ocak 2027"]);
    expect(monthsCovering([])).toEqual([]);
  });
});

describe("Notifications page", () => {
  it("type → category: document, result, message; the rest are status updates", () => {
    expect(notificationCategory("document.requested")).toBe("doc");
    expect(notificationCategory("document.action_required")).toBe("doc");
    expect(notificationCategory("application.visa_outcome")).toBe("result");
    expect(notificationCategory("message.new")).toBe("msg");
    for (const kind of ["application.status", "appointment.scheduled", "payment.reviewed", "form.unlocked", "task.new"]) {
      expect(notificationCategory(kind), kind).toBe("status");
    }
  });

  it("'action required' only if the requested action is still pending on the application", () => {
    const none = { documents: false, form: false, task: false, appointment: false };
    expect(notificationPendingAction("document.requested")).toBe("documents");
    expect(notificationPendingAction("application.status")).toBeNull();
    expect(notificationRequiresAction("document.requested", { ...none, documents: true })).toBe(true);
    // The customer uploaded the document: the old notification no longer requires action.
    expect(notificationRequiresAction("document.requested", none)).toBe(false);
    expect(notificationRequiresAction("appointment.preferences_requested", { ...none, appointment: true })).toBe(true);
    expect(notificationRequiresAction("message.new", { documents: true, form: true, task: true, appointment: true })).toBe(false);
    expect(notificationRequiresAction("task.new", undefined)).toBe(false);
  });

  it("the row's button is labelled by type and goes to the right page", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(notificationLink("document.requested", id)).toEqual({ label: "Belgeyi yükle", href: `/panel/applications/${id}/documents#requested-documents` });
    expect(notificationLink("document.sent", id).href).toBe(`/panel/applications/${id}/documents#requested-documents`);
    expect(notificationLink("application.visa_outcome", id)).toEqual({ label: "Sonucu gör", href: `/panel/applications/${id}` });
    expect(notificationLink("message.new", id)).toEqual({ label: "Mesajı aç", href: `/panel/applications/${id}#messages` });
    expect(notificationLink("application.status", id)).toEqual({ label: "Başvuruya git", href: `/panel/applications/${id}` });
    expect(notificationLink("appointment.preferences_requested", id).href).toBe(`/panel/applications/${id}/appointment`);
  });

  it("day groups and times are in Istanbul time", () => {
    const now = new Date("2026-10-15T09:00:00Z");
    expect(notificationDay("2026-10-14T22:48:00Z", now)).toEqual({ key: "2026-10-15", label: "Bugün" }); // 01:48 Istanbul
    expect(notificationClock("2026-10-14T22:48:00Z")).toBe("01:48");
    expect(notificationDay("2026-10-14T10:00:00Z", now)).toEqual({ key: "2026-10-14", label: "Dün · 14.10.2026" });
    expect(notificationDay("2026-10-12T10:00:00Z", now)).toEqual({ key: "2026-10-12", label: "12.10.2026" });
    const groups = groupByDay([
      { id: "a", dayKey: "2026-10-15", dayLabel: "Bugün" },
      { id: "b", dayKey: "2026-10-15", dayLabel: "Bugün" },
      { id: "c", dayKey: "2026-10-14", dayLabel: "Dün · 14.10.2026" },
    ]);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Bugün", ["a", "b"]],
      ["Dün · 14.10.2026", ["c"]],
    ]);
  });

  it("tab and category filter together; category counts depend on the selected tab", () => {
    const items = [
      { id: 1, category: "doc" as const, read: false },
      { id: 2, category: "status" as const, read: true },
      { id: 3, category: "status" as const, read: false },
      { id: 4, category: "msg" as const, read: true },
    ];
    const all = filterNotifications(items, { tab: "all", category: "all" });
    expect(all.shown).toHaveLength(4);
    expect(all.counts).toEqual({ all: 4, doc: 1, result: 0, status: 2, msg: 1 });
    const unreadStatus = filterNotifications(items, { tab: "unread", category: "status" });
    expect(unreadStatus.shown.map((n) => n.id)).toEqual([3]);
    expect(unreadStatus.counts).toEqual({ all: 2, doc: 1, result: 0, status: 1, msg: 0 });
  });
});

describe("appointment calendar leaf (home page)", () => {
  it("gives the month name and day in Istanbul time", () => {
    expect(appointmentLeaf("2026-11-27T07:30:00Z")).toEqual({ month: "Kasım", day: "27", time: "10:30" });
    // The night of 30 November in UTC is 1 December in Istanbul.
    expect(appointmentLeaf("2026-11-30T22:30:00Z")).toEqual({ month: "Aralık", day: "1", time: "01:30" });
    expect(appointmentLeaf("geçersiz")).toBeNull();
  });
});
