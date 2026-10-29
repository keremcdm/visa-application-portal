/**
 * NOTIFICATION E-MAILS
 *
 * Every in-app notification sent to the customer is also sent as an e-mail. This file is pure functions (no
 * imports): the server uses it when sending, tests use it for verification.
 *
 * The logo and the button are centered in the e-mail.
 *
 * There are two content levels:
 *   * "summary" (summary): subject + what happened and what to do; details (message text, reason, appointment location) only in the panel.
 *   * "full" (full): the notification's details are in the e-mail too. For types whose detail is a complete sentence addressed
 *     to the customer (SELF_CONTAINED) that sentence replaces the summary; the same information is never repeated in two boxes. If the main text already contains the application number it is not written again.
 * The visa outcome is never written into an e-mail at any level; the customer sees it in the panel. The phrase "Vize kararını
 * yetkili makam verir" was removed from e-mails; it stays on the site. Notification titles come from code and
 * contain no personal data; the detail text (body) may contain text written by staff and is HTML-escaped.
 */

export type EmailDetail = "summary" | "full";

export type NotificationEmailInput = {
  kind: string;
  title: string;
  body: string;
  firstName: string | null;
  referenceCode: string | null;
  /** Full address the button links to. */
  link: string;
  /** Button text ("Mesajı aç", "Belgeyi yükle" …). */
  linkLabel: string;
  detail: EmailDetail;
  companyName: string;
  /** Address of the panel (shown in the footer). */
  siteUrl: string;
  /**
   * Address of the logo: an image embedded in the e-mail when sending ("cid:logo"), a data: URL in previews. The logo is a
   * 360 × 189 PNG (public/brand/logo-email.png); shown 152px wide in the e-mail.
   */
  logoSrc: string;
  /**
   * Date, time and location for appointment notifications; shown like the appointment box on the site. Also shown at the "summary" level: it is the information the customer needs to attend.
   */
  appointment?: EmailAppointment | null;
};

/** Appointment box (values formatted on the server in Istanbul time; src/features/appointments/calendar.ts). */
export type EmailAppointment = {
  month: string;
  day: string;
  year: string;
  longDate: string;
  time: string;
  place: string | null;
  address: string | null;
  mapsUrl: string | null;
  /** The consultant's note about the appointment (e.g. "pasaportunuzun aslını getiriniz"); null if none. */
  note: string | null;
  /** Did the consultant upload an appointment letter? The letter itself is not attached to the e-mail; it is opened from the portal. */
  hasLetter?: boolean;
};

const APPOINTMENT_LETTER_TEXT = "Randevu belgeniz (appointment letter) başvuru sayfanıza eklendi; panelinizden görüntüleyip indirebilirsiniz.";

export type RenderedEmail = { subject: string; text: string; html: string };

/** The e-mail explanation for every notification type: what happened and what the customer needs to do. */
const SUMMARIES: Record<string, string> = {
  "application.submitted":
    "Başvurunuz bize ulaştı. Sonraki adım ödemenizi yapıp panelinizden “Ödemeyi yaptım” ile bildirmenizdir; banka bilgileri başvurunuzda yer alır.",
  "application.status": "Başvurunuzun durumu değişti. Güncel durumu ve sizden beklenen bir işlem olup olmadığını panelinizde görebilirsiniz.",
  "application.reminder": "Başvurunuzda sizden beklenen bir işlem var. Panelinize giriş yaparak tamamlayabilirsiniz.",
  "application.visa_outcome":
    "Vize başvurunuzun sonucu panelinize eklendi. Sonucu görmek için panelinize giriş yapıp başvurunuzu açınız.",
  "payment.reviewed": "Ödemenizle ilgili kontrol tamamlandı. Sonucu ve varsa yapmanız gerekenleri panelinizde görebilirsiniz.",
  "payment.declared": "Ödeme bildiriminiz alındı. Danışmanlarımız banka hesabını kontrol ettikten sonra ödemeniz doğrulanacak ve size bildirilecektir.",
  "payment.verified": "Ödemeniz danışmanlarımız tarafından doğrulandı. Başvurunuzun incelenmesine başlanacak.",
  "payment.rejected": "Ödemeniz doğrulanamadı. Danışmanınızın açıklamasını okuyup ödemenizi kontrol ediniz; gerekiyorsa yeni dekont yükleyip yeniden bildiriniz.",
  "document.action_required": "Belgelerinizden biriyle ilgili işlem yapmanız gerekiyor. Danışmanınızın notunu panelinizde okuyup belgeyi yeniden yükleyiniz.",
  "document.requested": "Danışmanınız sizden yeni bir belge istedi. İstenen belgeyi panelinizdeki Evraklar bölümünden yükleyiniz.",
  // when the consultant sends the customer a document to fill in/sign.
  "document.sent":
    "Kontrol etmeniz/imzalamanız için size yeni bir belge gönderildi. Lütfen belgeyi inceleyip tamamladıktan sonra ilgili kısma yeniden yükleyin.",
  "form.unlocked": "Danışmanınız başvuru formunuzu düzeltmeniz için yeniden açtı. Lütfen formu kontrol edip güncelleyiniz.",
  "form.locked": "Başvuru formunuz düzenlemeye kapatıldı. Yaptığınız düzeltmeler danışmanınıza iletildi.",
  "form.edit_declined": "Form düzenleme isteğiniz danışmanınız tarafından kabul edilmedi. Açıklamayı panelinizde görebilirsiniz.",
  "task.new": "Danışmanınız sizden bir işlem yapmanızı istedi. Ayrıntıyı panelinizde görebilirsiniz.",
  "message.new": "Danışmanınız size bir mesaj gönderdi. Mesajı panelinizde okuyabilirsiniz.",
  "appointment.scheduled": "Randevu tarihiniz bildirildi. Tarih, saat ve yer bilgisini panelinizde görebilirsiniz.",
  "appointment.updated": "Randevu bilgileriniz danışmanınız tarafından güncellendi. Güncel tarih, saat ve yer bilgisini panelinizde görebilirsiniz.",
  "appointment.preferences_requested": "Danışmanınız sizden yeni randevu tercihleri istedi. Uygun olduğunuz günleri panelinizden bildiriniz.",
  "appointment.withdrawn": "Danışmanınız daha önce bildirilen randevuyu geri çekti. Yeni randevu bilgisi bildirildiğinde size haber verilecektir.",
  "appointment.completed": "Randevunuzun saati geçti. Sonuç açıklandığında size bildirilecektir.",
  // "Evraklar tamamlandı" (documents complete): instead of the generic "status updated".
  "application.documents_reviewed": "Evraklarınız incelendi. Randevunuz ayarlandığında tarih, saat ve yer bilgisi size bildirilecektir.",
  "account.deletion_rejected": "Hesap silme talebiniz sonuçlandı. Açıklamayı panelinizdeki Bildirimler sayfasında görebilirsiniz.",
};
const DEFAULT_SUMMARY = "Hesabınızla ilgili yeni bir bildirim var. Ayrıntıyı panelinizde görebilirsiniz.";

/** Types whose detail is never written into the e-mail at any level. */
const NEVER_DETAILED = new Set(["application.visa_outcome"]);

/**
 * Types whose detail (body) is a complete sentence addressed to the customer: at the "full" level this sentence replaces the
 * summary as the main paragraph and no separate detail box is drawn.
 */
const SELF_CONTAINED = new Set([
  "application.submitted",
  "application.reminder",
  "payment.declared",
  "payment.verified",
  "form.unlocked",
  "form.locked",
  "appointment.withdrawn",
  "appointment.preferences_requested",
  "application.documents_reviewed",
  "document.sent",
]);

export function emailSummary(kind: string): string {
  return SUMMARIES[kind] ?? DEFAULT_SUMMARY;
}

function normalizedBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

/** Main paragraph of the e-mail: the type's summary; at the "full" level for a type whose detail is a full sentence, the detail itself. */
export function emailMainText(input: Pick<NotificationEmailInput, "kind" | "body" | "detail">): string {
  const body = normalizedBody(input.body);
  if (input.detail === "full" && SELF_CONTAINED.has(input.kind) && body !== "") return body;
  return emailSummary(input.kind);
}

/** Detail shown in a separate box at the "full" level; null if none (or if it was shown in the main paragraph). */
export function emailDetailText(input: Pick<NotificationEmailInput, "kind" | "body" | "detail">): string | null {
  if (input.detail !== "full" || NEVER_DETAILED.has(input.kind) || SELF_CONTAINED.has(input.kind)) return null;
  const body = normalizedBody(input.body);
  return body === "" ? null : body;
}

/** Detail label suitable for formatting. */
function detailLabel(kind: string): string {
  if (kind === "message.new") return "Mesaj";
  if (kind === "payment.reviewed" || kind === "payment.rejected" || kind === "account.deletion_rejected" || kind === "form.edit_declined") return "Açıklama";
  if (kind.startsWith("appointment.")) return "Randevu";
  if (kind.startsWith("document.")) return "Belge";
  if (kind === "task.new") return "İstenen işlem";
  return "Ayrıntı";
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Line breaks in titles cannot be used in the e-mail subject. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

// E-mail clients do not support CSS variables; the colors are the values of the tokens in globals.css
// (dash-navy, accent-600, dash-canvas, dash-line, dash-ink-2, dash-ink-3, dash-subtle).
const C = { navy: "#19214F", red: "#C72635", canvas: "#F6F5F1", line: "#E6E6EC", ink2: "#585E80", ink3: "#7C8099", subtle: "#F3F3F6" } as const;
const FONT = "Figtree, 'Segoe UI', Arial, sans-serif";

export function renderNotificationEmail(input: NotificationEmailInput): RenderedEmail {
  const title = oneLine(input.title) || "Yeni bildirim";
  // The subject uses the same format as Supabase's own e-mails: "Title | Company".
  const subject = `${title} | ${input.companyName}`;
  const greeting = input.firstName?.trim() ? `Merhaba ${input.firstName.trim()},` : "Merhaba,";
  const summary = emailMainText(input);
  // When the appointment box is shown the same information is not repeated in the detail box.
  const detail = input.appointment ? null : emailDetailText(input);
  const label = detailLabel(input.kind);
  // If the application number already appears in the main text or the detail it is not written again.
  const mentioned = (code: string) => summary.includes(code) || (detail?.includes(code) ?? false);
  const reference = input.referenceCode && !mentioned(input.referenceCode) ? `Başvuru numarası: ${input.referenceCode}` : null;
  const footer = [
    `Bu e-posta, ${input.companyName} Vize Başvuru Portalı'ndaki hesabınızla ilgili otomatik bir bildirimdir; lütfen yanıtlamayınız.`,
    "Tüm bildirimlerinizi panelinizdeki Bildirimler sayfasında görebilirsiniz.",
  ];

  const appointment = input.appointment ?? null;
  const appointmentLines = appointment
    ? [
        "",
        `Randevu: ${appointment.longDate}, saat ${appointment.time} (Türkiye saati)`,
        ...(appointment.place || appointment.address ? [`Yer: ${[appointment.place, appointment.address].filter(Boolean).join(" — ")}`] : []),
        ...(appointment.mapsUrl ? [`Haritada aç: ${appointment.mapsUrl}`] : []),
        ...(appointment.note ? [`Not: ${appointment.note}`] : []),
        ...(appointment.hasLetter ? [APPOINTMENT_LETTER_TEXT] : []),
      ]
    : [];

  const text = [
    greeting,
    "",
    title,
    summary,
    ...appointmentLines,
    ...(reference ? ["", reference] : []),
    ...(detail ? ["", `${label}:`, detail] : []),
    "",
    `${input.linkLabel}: ${input.link}`,
    "",
    "—",
    ...footer,
    input.siteUrl,
  ].join("\n");

  const p = (content: string, style = "") => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.ink2};${style}">${content}</p>`;
  const detailBlock = detail
    ? `<tr><td style="padding:0 32px 18px"><div style="background:${C.subtle};border-radius:14px;padding:14px 16px">
<div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:${C.ink3};text-transform:uppercase;margin:0 0 6px">${escapeHtml(label)}</div>
<div style="font-size:15px;line-height:1.6;color:${C.navy};white-space:pre-line">${escapeHtml(detail)}</div></div></td></tr>`
    : "";

  // E-mail counterpart of the appointment box on the site: navy strip, calendar leaf with a red header, date and time,
  // location and "Haritada aç" below. Tables and inline styles are used for e-mail clients.
  const appointmentBlock = appointment
    ? `<tr><td style="padding:0 32px 18px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.navy};border-radius:20px">
<tr><td style="padding:16px">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td valign="middle" style="width:84px">
<table role="presentation" width="84" cellspacing="0" cellpadding="0" style="background:#FFFFFF;border-radius:14px;text-align:center">
<tr><td style="background:${C.red};border-radius:14px 14px 0 0;padding:5px 0;font-size:11px;font-weight:800;letter-spacing:.12em;color:#FFFFFF;text-transform:uppercase">${escapeHtml(appointment.month.toLocaleUpperCase("tr-TR"))}</td></tr>
<tr><td style="padding:8px 0 0;font-size:34px;font-weight:800;line-height:1;color:${C.navy}">${escapeHtml(appointment.day)}</td></tr>
<tr><td style="padding:2px 0 8px;font-size:11px;font-weight:700;color:${C.ink2}">${escapeHtml(appointment.year)}</td></tr>
</table></td>
<td valign="middle" style="padding-left:16px">
<div style="font-size:12px;font-weight:800;letter-spacing:.1em;color:#A9AECB">RANDEVU</div>
<div style="font-size:19px;font-weight:800;line-height:1.3;color:#FFFFFF">${escapeHtml(appointment.longDate)}</div>
<div style="font-size:15px;font-weight:700;color:#FFFFFF">${escapeHtml(appointment.time)} <span style="font-weight:600;color:#A9AECB">Türkiye saati</span></div>
</td></tr></table>
</td></tr>
${
  appointment.place || appointment.address
    ? `<tr><td style="padding:0 16px 16px"><div style="border-top:1px solid #3A4270;padding-top:14px">
${appointment.place ? `<div style="font-size:16px;font-weight:800;color:#FFFFFF">${escapeHtml(appointment.place)}</div>` : ""}
${appointment.address ? `<div style="font-size:14px;line-height:1.5;color:#C9CCE0;white-space:pre-line">${escapeHtml(appointment.address)}</div>` : ""}
${appointment.mapsUrl ? `<a href="${escapeHtml(appointment.mapsUrl)}" style="display:inline-block;margin-top:12px;background:#FFFFFF;color:${C.navy};text-decoration:none;font-weight:800;font-size:14px;line-height:1;padding:12px 18px;border-radius:999px">Haritada aç</a>` : ""}
</div></td></tr>`
    : ""
}
${
  appointment.note
    ? `<tr><td style="padding:0 16px 16px"><div style="background:#2A3166;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.5;color:#FFFFFF;white-space:pre-line"><span style="font-weight:800">Not: </span>${escapeHtml(appointment.note)}</div></td></tr>`
    : ""
}
${
  appointment.hasLetter
    ? `<tr><td style="padding:0 16px 16px;font-size:14px;line-height:1.5;color:#C9CCE0">${escapeHtml(APPOINTMENT_LETTER_TEXT)}</td></tr>`
    : ""
}
</table></td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas};font-family:${FONT};color:${C.navy}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.canvas};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${C.line};border-radius:22px;overflow:hidden">
<tr><td align="center" style="padding:22px 32px;border-bottom:1px solid ${C.line};text-align:center"><img src="${escapeHtml(input.logoSrc)}" width="152" height="80" alt="${escapeHtml(input.companyName)}" style="display:block;margin:0 auto;border:0;width:152px;height:80px;color:${C.navy};font-size:17px;font-weight:800"></td></tr>
<tr><td style="padding:26px 32px 8px">
${p(escapeHtml(greeting), `color:${C.navy}`)}
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:800;letter-spacing:-.02em;color:${C.navy}">${escapeHtml(title)}</h1>
${p(escapeHtml(summary))}
${reference ? p(escapeHtml(reference), `font-size:13px;color:${C.ink3}`) : ""}
</td></tr>
${appointmentBlock}
${detailBlock}
<tr><td align="center" style="padding:4px 32px 28px;text-align:center">
<a href="${escapeHtml(input.link)}" style="display:inline-block;background:${C.navy};color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;line-height:1;padding:15px 24px;border-radius:999px">${escapeHtml(input.linkLabel)}</a>
<p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:${C.ink3}">Düğme çalışmazsa bu adresi tarayıcınıza yapıştırınız:<br><a href="${escapeHtml(input.link)}" style="color:${C.red};word-break:break-all">${escapeHtml(input.link)}</a></p>
</td></tr>
<tr><td style="padding:18px 32px 22px;border-top:1px solid ${C.line};background:#FFFFFF">
${footer.map((line) => `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${C.ink3}">${escapeHtml(line)}</p>`).join("\n")}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
