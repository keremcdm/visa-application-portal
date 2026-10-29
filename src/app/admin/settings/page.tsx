import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RecoveryCodePanel } from "@/components/auth/recovery-code-panel";
import { DocumentRulesManager } from "@/components/staff/document-rules-manager";
import {
  AppointmentLocationsManager,
  CitiesManager,
  DocumentCatalogManager,
  DocumentTypesManager,
  GeneralSettingsForm,
  ResetMfaButton,
  StaffAccessButton,
  StaffAdminButton,
  StaffDeleteButton,
  StaffInviteForm,
  ZipCategoriesManager,
} from "@/components/staff/settings-forms";
import { Alert, Badge, CardSection, cn, LoadingBlock } from "@/components/ui/primitives";
import { parseAppointmentConfig } from "@/features/appointments/window";
import { ruleTitle } from "@/features/documents/document-rules";
import { ROUTES } from "@/lib/site";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { requireStaff } from "@/server/auth";
import { companyContactFrom, fetchSettings, paymentInfoFrom } from "@/server/data/queries";
import {
  loadAppointmentLocations,
  loadCitySettings,
  loadDocumentRules,
  loadDocumentTypes,
  loadOwnRecoveryCodeStatus,
  loadStaffMembers,
  loadZipCategories,
} from "@/server/data/staff";
import { extraDocumentLimitFrom } from "@/features/documents/extra-documents";

export const metadata: Metadata = { title: "Ayarlar" };

const SECTIONS = [
  { id: "general", label: "Genel" },
  { id: "cities", label: "Randevu şehirleri" },
  { id: "locations", label: "Randevu yerleri" },
  { id: "documents", label: "Belge kuralları" },
  { id: "zip", label: "ZIP klasörleri" },
  { id: "staff", label: "Personel" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

async function Content({ searchParams }: Pick<PageProps<"/admin/settings">, "searchParams">) {
  const user = await requireStaff();
  const query = await searchParams;
  const current: SectionId = SECTIONS.some((s) => s.id === query.section) ? (query.section as SectionId) : "general";
  const supabase = await createClient();

  let body: React.ReactNode = null;

  if (current === "general") {
    const settings = await fetchSettings(supabase);
    const payment = paymentInfoFrom(settings);
    const contact = companyContactFrom(settings);
    const appointment = parseAppointmentConfig(settings);
    const missing = [
      !payment.configured ? "Banka hesap sahibi ve IBAN girilmedi (müşteriye ödeme bilgisi gösterilemez)." : null,
      !contact.email && !contact.phone ? "İletişim bilgisi girilmedi." : null,
    ].filter((item): item is string => item !== null);
    body = (
      <>
        {missing.length > 0 ? (
          <Alert tone="warning" title="Tamamlanmamış yapılandırma" className="mb-5">
            <ul className="list-disc space-y-1 pl-5">
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <CardSection title="Genel ayarlar">
          <GeneralSettingsForm
            initial={{
              contactEmail: contact.email ?? "",
              contactPhone: contact.phone ?? "",
              accountHolder: payment.accountHolder ?? "",
              bankName: payment.bankName ?? "",
              iban: payment.iban ?? "",
              paymentInstructions: payment.instructions ?? "",
              receiptUploadEnabled: payment.receiptUploadEnabled,
              appointmentStartOffsetDays: appointment.startOffsetDays,
              appointmentWindowDays: appointment.windowDays,
              appointmentIncludeWeekends: appointment.includeWeekends,
              appointmentExcludedDates: appointment.excludedDates.join("\n"),
              retentionMonths: typeof settings["retention.closed_months"] === "number" ? String(settings["retention.closed_months"]) : "",
              extraDocumentLimit: extraDocumentLimitFrom(settings),
            }}
          />
        </CardSection>
      </>
    );
  } else if (current === "cities") {
    const cities = await loadCitySettings();
    body = (
      <CardSection
        title="Randevu şehirleri"
        description="Müşteri, randevu tercihi adımında bu şehirlerden birini seçer. Hiç şehir tanımlanmazsa müşteriye şehir sorulmaz. Sırayı “Sırayı değiştir” ile belirleyebilirsiniz; belirlenmemişse İstanbul ve Ankara başta, diğerleri alfabetiktir. Ek ücret, müşteriye randevu şehri seçiminde tutarıyla gösterilir."
      >
        <CitiesManager items={cities} />
      </CardSection>
    );
  } else if (current === "locations") {
    const locations = await loadAppointmentLocations();
    body = (
      <CardSection
        title="Randevu yerleri"
        description="Randevu tarihini bildirirken yer bu listeden seçilir; seçilen yerin adı ve adresi müşteriye gösterilir. Sırayı “Sırayı değiştir” ile belirleyebilirsiniz; belirlenmemişse alfabetiktir. Bir yeri silmek veya değiştirmek, daha önce bildirilmiş randevuları etkilemez."
      >
        {locations ? (
          <AppointmentLocationsManager items={locations} />
        ) : (
          <Alert tone="warning">Randevu yerleri için veritabanı güncellemesi (12. dosya) henüz çalıştırılmadı.</Alert>
        )}
      </CardSection>
    );
  } else if (current === "documents") {
    const [types, categories, rules] = await Promise.all([loadDocumentTypes(), loadZipCategories(), loadDocumentRules()]);
    const unmapped = types.filter((t) => t.isActive && !t.zipCategoryId).length;
    const activeCategories = categories.filter((c) => c.isActive).map((c) => ({ id: c.id, folderName: c.folderName }));
    const documentValues = types.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      applicationType: t.applicationType,
      sponsorStatus: t.sponsorStatus,
      requirement: t.requirement,
      maxFiles: t.maxFiles,
      zipCategoryId: t.zipCategoryId,
      isActive: t.isActive,
      minorsOnly: t.minorsOnly,
    }));
    const zipNote =
      unmapped > 0 ? `${unmapped} belge henüz bir ZIP klasörüne eşleştirilmedi; bu belgeler ZIP'in kök dizinine konulur.` : "Tüm belgeler bir ZIP klasörüne eşleştirilmiş.";
    // Since migration 20: documents are a single list; which application requires them is set by type-combination rules.
    if (rules) {
      const usage: Record<string, string[]> = {};
      for (const rule of rules) for (const item of rule.items) (usage[item.documentTypeId] ??= []).push(ruleTitle(rule));
      body = (
        <div className="space-y-5">
          <CardSection
            title="Kurallar: hangi başvuruda hangi belgeler istenir?"
            description="Bir kural, içindeki başvuru tiplerinin HEPSİNİ seçen müşterilere uygulanır. Örneğin “Öğrenci + Sponsorlu Başvuru” kuralı, müşteri hem Öğrenci hem Sponsorlu Başvuru seçtiğinde ek olarak uygulanır; yalnızca Öğrenci seçene uygulanmaz. Aynı belge birden çok kuraldan gelirse en sıkı kural geçerlidir (zorunlu, sonra koşullu, sonra isteğe bağlı). Değişiklikler taslak başvurulara bir sonraki açılışta uygulanır; gönderilmiş başvurular etkilenmez."
          >
            <DocumentRulesManager
              rules={rules}
              documents={types.map((t) => ({ id: t.id, label: t.label, isActive: t.isActive, minorsOnly: t.minorsOnly }))}
            />
          </CardSection>
          <CardSection
            title="Belgeler"
            description={`Her belgenin adı, müşteriye gösterilen açıklaması, ZIP klasörü ve en fazla dosya sayısı. Müşteri belgeleri bu listedeki sırayla görür; sırayı “Sırayı değiştir” ile belirleyebilirsiniz. Yeni belge, bir kurala eklenene kadar hiçbir başvuruda istenmez. ${zipNote}`}
          >
            <DocumentCatalogManager items={documentValues} categories={activeCategories} usage={usage} />
          </CardSection>
        </div>
      );
    } else body = (
      <>
        <Alert tone="info" className="mb-5">
          <p>
            Her belgenin adını, müşteriye gösterilen açıklamasını, kuralını (zorunlu / isteğe bağlı) ve ZIP içinde gideceği klasörü
            buradan belirleyebilirsiniz. Her grubun altındaki “Bu gruba belge ekle” ile yeni belge ekleyebilir, “Sil” ile gereksiz belgeyi
            kaldırabilirsiniz.
          </p>
          <p className="mt-2">{zipNote}</p>
          <p className="mt-2">
            Başvuru tipi kombinasyonlarına göre kural (ör. “Öğrenci + Sponsorlu”) ve sürükleyerek sıralama için veritabanı güncellemesi (20. dosya)
            çalıştırılmalıdır.
          </p>
        </Alert>
        <DocumentTypesManager items={documentValues} categories={activeCategories} />
      </>
    );
  } else if (current === "zip") {
    const [categories, types] = await Promise.all([loadZipCategories(), loadDocumentTypes()]);
    body = (
      <CardSection
        title="ZIP kategori klasörleri"
        description="“Tüm evrakları indir” ile oluşan ZIP dosyasındaki klasörler. Etkin klasörler, içleri boş olsa bile her ZIP'te yer alır. Klasör adları yazıldığı gibi kullanılır."
      >
        <ZipCategoriesManager
          items={categories.map((c) => ({
            id: c.id,
            folderName: c.folderName,
            isActive: c.isActive,
            documentCount: types.filter((t) => t.zipCategoryId === c.id).length,
          }))}
        />
      </CardSection>
    );
  } else {
    const members = await loadStaffMembers();
    const adminConfigured = isAdminClientConfigured();
    const recovery = await loadOwnRecoveryCodeStatus();
    body = (
      <div className="space-y-5">
        {/* The person's own recovery code. For all staff. */}
        <CardSection
          title="İki adımlı doğrulama yedek kodunuz"
          description="Telefonunuzu veya doğrulama uygulamanızı kaybederseniz girişte “Doğrulayıcıma erişemiyorum” bağlantısıyla bu kodu yazıp doğrulamayı kendiniz yeniden kurarsınız. Kod yalnızca oluşturulduğu an bir kez gösterilir."
        >
          {recovery.status === "unavailable" ? (
            <Alert tone="info">Yedek kod şu anda kullanılamıyor (veritabanı güncellemesi bekleniyor).</Alert>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {recovery.createdAt ? `Yedek kodunuz ${formatDateTimeTr(recovery.createdAt)} tarihinde oluşturuldu.` : "Henüz yedek kodunuz yok."}
              </p>
              <RecoveryCodePanel variant="admin" hasCode={recovery.createdAt !== null} />
            </div>
          )}
        </CardSection>
        <CardSection
          title="Personel hesapları"
          description="Her danışmanın kendi hesabı olmalıdır; hesap paylaşılmamalıdır. Başvurularla ilgili işlemleri bütün personel yapar. Personel davet etme, erişim kapatma/açma, iki adımlı doğrulamayı sıfırlama, yönetici atama ve personel silme yalnızca yöneticilerdedir. Yönetim paneline girişte şifreye ek olarak telefondaki doğrulama uygulamasının kodu istenir."
        >
          {user.isAdmin ? null : (
            <Alert tone="info" className="mb-3">
              Siz yönetici değilsiniz: bu listeyi görebilirsiniz ancak personel işlemlerini (davet, erişim, doğrulama sıfırlama) yalnızca yöneticiler yapabilir.
            </Alert>
          )}
          <ul className="divide-y divide-line">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {member.name} {member.id === user.id ? <Badge tone="info">Siz</Badge> : null} {member.isAdmin ? <Badge tone="success">Yönetici</Badge> : null}{" "}
                    {!member.isActive ? <Badge>Erişimi kapalı</Badge> : null}
                  </p>
                  <p className="text-sm text-muted">
                    {member.email} · Eklendi: {formatDateTimeTr(member.createdAt)}
                  </p>
                  <p className="mt-1 text-sm">
                    {member.mfaEnabled === null ? (
                      <Badge>İki adımlı doğrulama: bilinmiyor</Badge>
                    ) : member.mfaEnabled ? (
                      <Badge tone="success">İki adımlı doğrulama kurulu</Badge>
                    ) : (
                      <Badge tone="warning">İki adımlı doğrulama kurulmadı (ilk girişte kurulur)</Badge>
                    )}
                  </p>
                </div>
                {member.id !== user.id && user.isAdmin ? (
                  <div className="flex flex-wrap items-start gap-2">
                    {member.mfaEnabled ? <ResetMfaButton userId={member.id} name={member.name} /> : null}
                    {member.isActive ? <StaffAdminButton userId={member.id} name={member.name} isAdmin={member.isAdmin} /> : null}
                    <StaffAccessButton userId={member.id} name={member.name} isActive={member.isActive} />
                    <StaffDeleteButton userId={member.id} name={member.name} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardSection>
        <CardSection
          title="Yeni personel davet et"
          description="Kişiye, şifresini belirleyeceği bir bağlantı içeren e-posta gönderilir. Herkese açık kayıt formundan personel hesabı oluşturulamaz."
        >
          {!user.isAdmin ? (
            <Alert tone="info">Yeni personeli yalnızca yöneticiler davet edebilir.</Alert>
          ) : adminConfigured ? (
            <StaffInviteForm />
          ) : (
            <Alert tone="warning">Davet göndermek için sunucuda SUPABASE_SECRET_KEY ortam değişkeni tanımlanmalıdır.</Alert>
          )}
        </CardSection>
      </div>
    );
  }

  return (
    <>
      {/* The admin panel's language: 30px heading, pill tabs, cards with 22px corners. */}
      <div className="mb-[22px] flex flex-col gap-2">
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">Ayarlar</h1>
        <p className="max-w-2xl text-[15px] leading-[1.6] text-dash-ink-2">Şirkete ait yapılandırma. Değişiklikler işlem geçmişine kaydedilir.</p>
      </div>
      <nav aria-label="Ayar bölümleri" className="mb-6 flex flex-wrap gap-2">
        {SECTIONS.map((section) => (
          <Link
            key={section.id}
            href={section.id === "general" ? ROUTES.staffSettings : `${ROUTES.staffSettings}?section=${section.id}`}
            aria-current={section.id === current ? "page" : undefined}
            className={cn(
              "flex h-11 items-center whitespace-nowrap rounded-full border-[1.5px] px-[18px] text-sm font-bold no-underline transition-colors motion-reduce:transition-none",
              section.id === current
                ? "border-dash-navy bg-dash-navy text-white hover:text-white"
                : "border-dash-line-strong bg-white text-dash-navy hover:bg-dash-subtle hover:text-dash-navy",
            )}
          >
            {section.label}
          </Link>
        ))}
      </nav>
      {body}
    </>
  );
}

export default function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  return (
    <Suspense fallback={<LoadingBlock lines={6} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
