import Link from "next/link";
import { ClipboardCheck, Mail, Phone } from "lucide-react";
import { ROUTES } from "@/lib/site";
import { telHref } from "@/lib/validation/formats";
import { ArchivedApplications, type ArchivedApplicationItem } from "./archived-applications";
import { CreateApplicationButton } from "./create-application-button";
import { DeleteDraftButton } from "./delete-draft-button";
import { NotificationsBox } from "./notifications-box";
import { ApplicationsCard, type ApplicationCardItem } from "./progress-card";

export type DraftCard = { id: string; referenceCode: string; typeText: string; updatedText: string; href: string };

export type DashboardViewProps = {
  firstName: string;
  /** Has the Risk Assessment Test been taken? If not, the suggestion card is shown. */
  riskTestDone: boolean;
  /** Ongoing or recently concluded submitted applications: all on a single navy card. */
  submitted: ApplicationCardItem[];
  drafts: DraftCard[];
  /** Applications concluded or cancelled about two weeks ago: under "Eski başvuruları göster". */
  archived: ArchivedApplicationItem[];
  hasApplications: boolean;
  /** Company contact details from Settings; if both are empty the "Bize ulaşın" (contact us) box is hidden. */
  contact: { email: string | null; phone: string | null };
};

/**
 * "Bize ulaşın" (contact us): the contact phone and e-mail from Settings → General. Tapping the phone starts a call,
 * tapping the e-mail opens the mail app. The box is hidden when nothing is entered.
 */
function ContactBox({ contact }: { contact: DashboardViewProps["contact"] }) {
  if (!contact.email && !contact.phone) return null;
  const tel = telHref(contact.phone);
  const row = "flex min-w-0 items-center gap-3 text-[15px] font-bold text-dash-navy no-underline hover:text-dash-red";
  const icon = "flex size-9 flex-none items-center justify-center rounded-full bg-dash-subtle text-dash-navy";
  return (
    <section aria-labelledby="contact-heading" className="flex flex-col gap-3 rounded-[22px] border border-dash-line bg-white px-6 py-5">
      <div className="flex flex-col gap-1">
        <h2 id="contact-heading" className="text-base font-bold">
          Bize ulaşın
        </h2>
        <p className="text-sm leading-[1.5] text-dash-ink-2">Başvurunuzla ilgili sorularınız için bize ulaşabilirsiniz.</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {contact.phone ? (
          <li>
            {tel ? (
              <a href={tel} className={row}>
                <span aria-hidden className={icon}>
                  <Phone className="size-4" strokeWidth={2.5} />
                </span>
                <span className="sr-only">Telefon: </span>
                {contact.phone}
              </a>
            ) : (
              <span className={row}>
                <span aria-hidden className={icon}>
                  <Phone className="size-4" strokeWidth={2.5} />
                </span>
                <span className="sr-only">Telefon: </span>
                {contact.phone}
              </span>
            )}
          </li>
        ) : null}
        {contact.email ? (
          <li>
            <a href={`mailto:${contact.email}`} className={row}>
              <span aria-hidden className={icon}>
                <Mail className="size-4" strokeWidth={2.5} />
              </span>
              <span className="sr-only">E-posta: </span>
              <span className="truncate">{contact.email}</span>
            </a>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/**
 * Risk Assessment Test suggestion: shown if the test has not been taken. A small card in the page's white card
 * style; it sits below the navy application card and above the "Devam eden başvurular" (applications in progress) heading.
 * The test is optional.
 */
function RiskTestRecommendation() {
  return (
    <section
      aria-labelledby="risk-suggestion-heading"
      className="flex flex-wrap items-center gap-4 rounded-[22px] border border-dash-line bg-white px-6 py-5"
    >
      <span aria-hidden className="flex size-11 flex-none items-center justify-center rounded-full bg-dash-red-tint text-dash-red">
        <ClipboardCheck className="size-5" strokeWidth={2.5} />
      </span>
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
        <h2 id="risk-suggestion-heading" className="text-base font-bold">
          Risk Analiz Testi&apos;ni yapmanızı öneririz
        </h2>
        <p className="text-sm leading-[1.5] text-dash-ink-2">
          Yaklaşık 3 dakikalık kısa test, profilinizin güçlü ve dikkat edilmesi gereken yönlerini gösterir. Zorunlu değildir; cevaplarınız
          başvuru formunu doldururken de kullanılabilir.
        </p>
      </div>
      <Link
        href={ROUTES.customerRiskTest}
        className="flex h-11 flex-none items-center whitespace-nowrap rounded-full bg-dash-navy px-[22px] text-[15px] font-bold text-white hover:bg-dash-navy-hover"
      >
        Teste başla
      </Link>
    </section>
  );
}

/**
 * Look of the customer panel home page. Reads no data;
 * src/app/panel/page.tsx prepares it. The top bar and notifications are in src/app/panel/layout.tsx.
 */
export function DashboardView({ firstName, riskTestDone, submitted, drafts, archived, hasApplications, contact }: DashboardViewProps) {
  return (
    <main id="content" className="mx-auto flex w-full max-w-[1080px] flex-col gap-7 px-4 pb-16 pt-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex max-w-[640px] flex-col gap-2">
          <h1 className="font-dash text-[34px] font-extrabold tracking-[-0.01em]">{firstName ? `Merhaba, ${firstName}` : "Merhaba"}</h1>
          <p className="text-[15px] leading-[1.6] text-dash-ink-2">
            Başvurularınızı buradan başlatabilir, kaldığınız yerden devam edebilir ve durumlarını takip edebilirsiniz.
          </p>
        </div>
        <CreateApplicationButton />
      </div>

      <ApplicationsCard items={submitted} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {riskTestDone ? null : <RiskTestRecommendation />}

          <section aria-labelledby="drafts-heading" className="flex min-w-0 flex-col gap-3">
            <h2 id="drafts-heading" className="font-dash text-[22px] font-extrabold tracking-[-0.02em]">
              Devam eden başvurular
            </h2>
            {drafts.length === 0 ? (
              <p className="rounded-[22px] border border-dash-line bg-white px-6 py-5 text-sm leading-6 text-dash-ink-2">
                {hasApplications
                  ? "Devam eden taslak başvurunuz yok."
                  : "Henüz bir başvurunuz yok. Başlamak için “Yeni başvuru oluştur” düğmesini kullanınız; bilgileriniz adım adım kaydedilir."}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {drafts.map((draft) => (
                  <li key={draft.id} className="flex flex-wrap items-center justify-between gap-5 rounded-[22px] border border-dash-line bg-white px-6 py-5">
                    <div className="flex min-w-0 flex-col gap-[5px]">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base font-bold">{draft.referenceCode}</span>
                        <span className="rounded-full bg-dash-draft-bg px-2.5 py-[3px] text-xs font-bold text-dash-draft-ink">Taslak</span>
                      </div>
                      <span className="text-sm leading-[1.45] text-dash-ink-2">{draft.typeText}</span>
                      <span className="text-[13px] text-dash-ink-3">Son güncelleme: {draft.updatedText}</span>
                    </div>
                    <div className="flex flex-wrap items-start gap-2.5">
                      <DeleteDraftButton applicationId={draft.id} referenceCode={draft.referenceCode} />
                      <Link href={draft.href} className="flex h-11 flex-none items-center rounded-full bg-dash-navy px-[22px] text-[15px] font-bold text-white hover:bg-dash-navy-hover">
                        Devam et
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {archived.length > 0 ? <ArchivedApplications items={archived} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <NotificationsBox />
          <ContactBox contact={contact} />
        </div>
      </div>
    </main>
  );
}
