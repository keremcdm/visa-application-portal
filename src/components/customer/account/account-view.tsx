import { Lock, Mail, Trash2, User } from "lucide-react";
import { AccountDeletion } from "@/components/customer/account-deletion";
import { EmailChangeForm, PasswordChangeForm } from "@/components/customer/credential-forms";
import { ProfileForm } from "@/components/customer/profile-form";
import { WizNote } from "@/components/customer/wizard/ui";
import { AccountSection } from "./account-section";

/** "07.10.2004": date of birth in the summary line. */
function dottedDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join(".") : "";
}

/** Initials on the profile card (Turkish upper case: i → İ). */
function initials(firstName: string, lastName: string, email: string): string {
  const letters = [firstName, lastName].map((part) => part.trim().charAt(0)).join("");
  return (letters || email.charAt(0)).toLocaleUpperCase("tr-TR");
}

const ICON = "size-[18px]";

export type AccountViewProps = {
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  createdAtText: string;
  pendingEmail: string | null;
  notice: { tone: "success" | "info"; text: string } | undefined;
  deletion: { available: boolean; hasSubmitted: boolean; pendingSince: string | null; lastRejection: { at: string; note: string } | null };
  today: string;
};

/*
 * MY ACCOUNT: navy profile card and single-column
 * cards; each card shows a summary of the current value when closed and its form when open. Texts, fields and rules
 * are the same as on the previous page. Reads no data; src/app/panel/account/page.tsx prepares it.
 */
export function AccountView({ firstName, lastName, birthDate, email, createdAtText, pendingEmail, notice, deletion, today }: AccountViewProps) {
  const fullName = `${firstName} ${lastName}`.trim();
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.02em]">Hesabım</h1>
        <p className="text-[15px] leading-[1.6] text-dash-ink-2">Hesabınıza ait kişisel bilgileri buradan görebilir ve düzeltebilirsiniz.</p>
      </div>

      {notice ? (
        <WizNote tone={notice.tone} role="status" onPage>
          {notice.text}
        </WizNote>
      ) : null}

      <div className="flex flex-wrap items-center gap-[22px] rounded-[28px] bg-dash-navy px-6 py-7 text-white sm:px-8">
        <span aria-hidden className="flex size-[72px] flex-none items-center justify-center rounded-full bg-white text-[26px] font-extrabold text-dash-navy">
          {initials(firstName, lastName, email)}
        </span>
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
          {fullName ? <p className="text-2xl font-extrabold tracking-[-0.01em]">{fullName}</p> : null}
          <p className="truncate text-sm text-dash-on-navy">{email}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <AccountSection
          icon={<User className={ICON} strokeWidth={2.5} />}
          title="Kişisel bilgiler"
          description="Bu bilgiler hesabınıza aittir. Başvuru formundaki bilgileriniz bundan etkilenmez; onları başvurunuzun form adımlarından düzenleyebilirsiniz."
          summary={[fullName, dottedDate(birthDate)].filter(Boolean).join(" · ") || null}
        >
          <ProfileForm initial={{ firstName, lastName, birthDate }} today={today} />
        </AccountSection>

        <AccountSection
          icon={<Mail className={ICON} strokeWidth={2.5} />}
          title="E-posta adresi"
          description={`Giriş için kullanılır. Hesabın oluşturulduğu tarih: ${createdAtText}.`}
          summary={email}
          notice={
            pendingEmail ? (
              <WizNote tone="info">
                <strong className="font-bold">{pendingEmail}</strong> adresi için doğrulama bekleniyor. Değişiklik, e-postadaki bağlantıyı onayladığınızda
                tamamlanır.
              </WizNote>
            ) : null
          }
        >
          <EmailChangeForm currentEmail={email} />
        </AccountSection>

        <AccountSection icon={<Lock className={ICON} strokeWidth={2.5} />} title="Şifre" summary={<span aria-hidden>••••••••••</span>}>
          <PasswordChangeForm />
        </AccountSection>

        <AccountSection icon={<Trash2 className={ICON} strokeWidth={2.5} />} title="Hesabı sil" danger collapsible={false}>
          <AccountDeletion
            available={deletion.available}
            hasSubmitted={deletion.hasSubmitted}
            pendingSince={deletion.pendingSince}
            lastRejection={deletion.lastRejection}
          />
        </AccountSection>
      </div>
    </>
  );
}

