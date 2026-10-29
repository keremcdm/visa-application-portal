import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { senderAddress } from "@/server/email/mailer";
import { emailDetailText, emailMainText, renderNotificationEmail, type NotificationEmailInput } from "@/server/email/templates";

/** Notification e-mails: summary / full content, the visa outcome never in an e-mail, text is escaped. */

const input = (extra: Partial<NotificationEmailInput> = {}): NotificationEmailInput => ({
  kind: "message.new",
  title: "Danışmanınızdan yeni mesaj",
  body: "TEST mesajı: belgelerinizi aldık.",
  firstName: "Deneme",
  referenceCode: "VB-2026-000123",
  link: "https://portal.example.com/panel/applications/x#messages",
  linkLabel: "Mesajı aç",
  detail: "summary",
  companyName: "Vize Başvuru Portalı",
  siteUrl: "https://portal.example.com",
  logoSrc: "cid:logo",
  ...extra,
});

describe("notification e-mail", () => {
  it("subject from the title and company name; greeting, explanation, application number and link present in both formats", () => {
    const mail = renderNotificationEmail(input());
    expect(mail.subject).toBe("Danışmanınızdan yeni mesaj | Vize Başvuru Portalı");
    expect(mail.text).toContain("Merhaba Deneme,");
    expect(mail.text).toContain("Danışmanınız size bir mesaj gönderdi.");
    expect(mail.text).toContain("Başvuru numarası: VB-2026-000123");
    expect(mail.text).toContain("Mesajı aç: https://portal.example.com/panel/applications/x#messages");
    expect(mail.html).toContain('href="https://portal.example.com/panel/applications/x#messages"');
    // The logo is an image embedded in the e-mail and centered.
    expect(mail.html).toContain('<td align="center" style="padding:22px 32px;');
    expect(mail.html).toMatch(/<img src="cid:logo"[^>]*style="display:block;margin:0 auto;/);
    // The button is centered too.
    expect(mail.html).toContain('<tr><td align="center" style="padding:4px 32px 28px;text-align:center">');
  });

  it("in the summary format the detail (message text) is not written to the e-mail; in the full format it is", () => {
    expect(renderNotificationEmail(input()).text).not.toContain("TEST mesajı");
    expect(renderNotificationEmail(input()).html).not.toContain("TEST mesajı");
    const full = renderNotificationEmail(input({ detail: "full" }));
    expect(full.text).toContain("Mesaj:\nTEST mesajı: belgelerinizi aldık.");
    expect(full.html).toContain("TEST mesajı: belgelerinizi aldık.");
  });

  it("in the full format the same information is not written twice: a detail that is a full sentence replaces the summary, the application number is not repeated", () => {
    // Problem fixed: the "Başvurunuz alındı" e-mail repeated the same content in two boxes.
    const body = "Başvuru numaranız: VB-2026-000123. Sonraki adım ödemenizi yapıp panelinizden “Ödemeyi yaptım” ile bildirmenizdir.";
    const submitted = input({ kind: "application.submitted", title: "Başvurunuz alındı", body, detail: "full" });
    expect(emailMainText(submitted)).toBe(body);
    expect(emailDetailText(submitted)).toBeNull();
    const mail = renderNotificationEmail(submitted);
    expect(mail.text.split("VB-2026-000123").length - 1).toBe(1);
    expect(mail.html.split("VB-2026-000123").length - 1).toBe(1);
    expect(mail.text).not.toContain("Başvurunuz bize ulaştı.");
    expect(mail.html).not.toContain("text-transform:uppercase");
    // No details in the summary format; the explanation and the application number each appear once.
    const short = renderNotificationEmail({ ...submitted, detail: "summary" });
    expect(short.text).toContain("Başvurunuz bize ulaştı.");
    expect(short.text.split("VB-2026-000123").length - 1).toBe(1);
  });

  it("the details of the visa outcome are not written to the e-mail, even in the full format", () => {
    expect(emailDetailText({ kind: "application.visa_outcome", body: "Onaylandı", detail: "full" })).toBeNull();
    const mail = renderNotificationEmail(input({ kind: "application.visa_outcome", title: "Vize başvurunuzun sonucu bildirildi", body: "GİZLİ", detail: "full" }));
    expect(mail.text).not.toContain("GİZLİ");
    // "Vize kararını yetkili makam verir" does not appear in e-mails.
    expect(mail.text).not.toContain("yetkili makam");
    expect(mail.html).not.toContain("yetkili makam");
  });

  it("for appointment notifications the date, time, location, map and note box are shown even at the summary level; text is escaped", () => {
    const mail = renderNotificationEmail(
      input({
        kind: "appointment.scheduled",
        title: "Randevu tarihiniz bildirildi",
        body: "Randevunuz: 23.10.2026 14:35 · VFS",
        appointment: {
          month: "Ekim",
          day: "23",
          year: "2026",
          longDate: "23 Ekim 2026, Cuma",
          time: "14:35",
          place: "VFS Global <İstanbul>",
          address: "Örnek Mah. 1",
          mapsUrl: "https://maps.example.com/x",
          note: "Pasaportunuzun aslını getiriniz.",
        },
      }),
    );
    expect(mail.html).toContain("23 Ekim 2026, Cuma");
    expect(mail.html).toContain("EKİM");
    expect(mail.html).toContain("VFS Global &lt;İstanbul&gt;");
    expect(mail.html).toContain('href="https://maps.example.com/x"');
    expect(mail.html).toContain("Pasaportunuzun aslını getiriniz.");
    expect(mail.text).toContain("Randevu: 23 Ekim 2026, Cuma, saat 14:35 (Türkiye saati)");
    expect(mail.text).toContain("Yer: VFS Global <İstanbul> — Örnek Mah. 1");
    // With the appointment box present, the same information is not written again in the detail box.
    expect(mail.text).not.toContain("Randevunuz: 23.10.2026");
    // If no appointment letter was uploaded it is not mentioned.
    expect(mail.text).not.toContain("appointment letter");
  });

  it("if an appointment letter was uploaded the e-mail says it can be opened from the panel", () => {
    const mail = renderNotificationEmail(
      input({
        kind: "appointment.scheduled",
        title: "Randevu tarihiniz bildirildi",
        body: "",
        appointment: {
          month: "Ekim",
          day: "23",
          year: "2026",
          longDate: "23 Ekim 2026, Cuma",
          time: "14:35",
          place: null,
          address: null,
          mapsUrl: null,
          note: null,
          hasLetter: true,
        },
      }),
    );
    expect(mail.text).toContain("Randevu belgeniz (appointment letter) başvuru sayfanıza eklendi");
    expect(mail.html).toContain("Randevu belgeniz (appointment letter) başvuru sayfanıza eklendi");
  });

  it("a document sent by the consultant and the completed document review go out with their own texts", () => {
    const sent = renderNotificationEmail(input({ kind: "document.sent", title: "Danışmanınız size yeni bir belge gönderdi", body: "" }));
    expect(sent.subject).toBe("Danışmanınız size yeni bir belge gönderdi | Vize Başvuru Portalı");
    expect(sent.text).toContain(
      "Kontrol etmeniz/imzalamanız için size yeni bir belge gönderildi. Lütfen belgeyi inceleyip tamamladıktan sonra ilgili kısma yeniden yükleyin.",
    );
    const reviewed = renderNotificationEmail(input({ kind: "application.documents_reviewed", title: "Evraklarınızın incelenmesi tamamlandı", body: "" }));
    expect(reviewed.text).toContain("Evraklarınız incelendi.");
    expect(reviewed.text).not.toContain("durumu değişti");
  });

  it("text written by staff is HTML-escaped; the subject is a single line", () => {
    const mail = renderNotificationEmail(input({ detail: "full", body: '<script>alert("x")</script>', title: "Başlık\nikinci satır" }));
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.subject).toBe("Başlık ikinci satır | Vize Başvuru Portalı");
  });

  it("an unknown notification type goes out with a generic explanation; 'Merhaba,' if there is no name", () => {
    const mail = renderNotificationEmail(input({ kind: "bilinmeyen.tur", firstName: null }));
    expect(mail.text).toContain("Merhaba,");
    expect(mail.text).toContain("Hesabınızla ilgili yeni bir bildirim var.");
  });
});

describe("Supabase e-mail templates", () => {
  const dir = path.join(process.cwd(), "supabase", "email-templates");
  const read = (...parts: string[]) => readFileSync(path.join(dir, ...parts), "utf8");

  it("all eight templates load the logo from the site's own address", () => {
    const files = readdirSync(dir).filter((file) => file.endsWith(".html"));
    expect(files).toHaveLength(8);
    for (const file of files) expect(read(file), file).toContain("{{ .SiteURL }}/brand/logo-email.png");
  });

  // The invitation e-mail does not promise staff or admin rights: an invitation sent from the Supabase dashboard
  // does not grant staff rights. The text uses the language of the customer sign-up e-mail; the link sets a password.
  it("invitation: no mention of staff/admin, same language as the customer sign-up, the link sets a password", () => {
    const html = read("invite-user.html");
    expect(html).not.toMatch(/personel|yönetici|danışman|\{\{ (if|else|end)\b/i);
    expect(html).toContain("adresiyle bir hesap oluşturuldu.");
    expect(read("confirm-signup.html")).toContain("adresiyle bir hesap oluşturuldu.");
    expect(html).toContain("{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite");
  });
});

describe("sender name", () => {
  it("the company name is added if SMTP_FROM is only an address; a name, if given, stays as it is", () => {
    expect(senderAddress("noreply@example.com", "Vize Başvuru Portalı")).toEqual({
      name: "Vize Başvuru Portalı",
      address: "noreply@example.com",
    });
    expect(senderAddress("Başka Ad <noreply@example.com>", "Vize Başvuru Portalı")).toBe("Başka Ad <noreply@example.com>");
  });
});
