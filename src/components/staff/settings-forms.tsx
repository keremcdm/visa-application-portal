"use client";

import { resetStaffMfaAction } from "@/server/actions/mfa";
import { useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { ActionButton, ActionFeedback, useServerAction } from "@/components/ui/action-button";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Button, cn } from "@/components/ui/primitives";
import { UnsavedChanges, useDraftRows } from "@/components/ui/unsaved-changes";
import { ReorderButton } from "./reorder-dialog";
import { errorsOfRow, rowFieldErrorKey } from "@/features/unsaved-changes/drafts";
import {
  APPLICATION_TYPE_LABELS,
  APPLICATION_TYPES,
  CURRENCIES_BY_LABEL,
  CURRENCY_LABELS,
  DOCUMENT_REQUIREMENT_LABELS,
  DOCUMENT_REQUIREMENTS,
  SPONSOR_STATUS_LABELS,
  SPONSOR_STATUSES,
  type ApplicationType,
  type Currency,
  type DocumentRequirement,
  type SponsorStatus,
} from "@/lib/domain/constants";
import { formatMoneyTr } from "@/lib/validation/formats";
import {
  deleteAppointmentLocationAction,
  deleteCityAction,
  deleteDocumentTypeAction,
  deleteStaffAction,
  deleteZipCategoryAction,
  inviteStaffAction,
  saveAppointmentLocationsAction,
  saveCitiesAction,
  saveDocumentCatalogAction,
  saveDocumentTypesAction,
  saveGeneralSettingsAction,
  saveZipCategoriesAction,
  setStaffActiveAction,
  setStaffAdminAction,
} from "@/server/actions/settings";
import type { ActionResult } from "@/server/result";
import { MAX_EXTRA_DOCUMENT_LIMIT } from "@/features/documents/extra-documents";

/*
 * SETTINGS TABS
 * Each tab has a single "Kaydet" (save); all changes in the tab are saved together. The bar only appears while there are
 * unsaved changes and warns when leaving without saving (UnsavedChanges).
 * Delete, invite and access actions run immediately; they are not tied to "Kaydet".
 */

type RowErrors = ReturnType<typeof errorsOfRow>;

/** Shared attributes binding a field's error message to its control. */
function invalidProps(id: string, error: string | undefined, hint?: boolean) {
  return { "aria-invalid": error ? true : undefined, "aria-describedby": describedBy(id, hint, error) };
}

type RowState = "saved" | "changed" | "new";

const ROW_NOTES: Record<RowState, string | null> = {
  saved: null,
  changed: "Değişti, henüz kaydedilmedi",
  new: "Yeni, henüz kaydedilmedi",
};

/** The border of a changed or new row darkens and a "kaydedilmedi" (not saved) note appears above it. */
function RowFrame({ state, errors, children }: { state: RowState; errors: RowErrors; children: ReactNode }) {
  const note = ROW_NOTES[state];
  return (
    <div className={cn("rounded-md border bg-white p-4", errors.row || Object.keys(errors.fields).length > 0 ? "border-accent-600" : note ? "border-brand-700" : "border-line")}>
      {note ? <p className="mb-2 text-xs font-medium text-brand-700">{note}</p> : null}
      {children}
      {errors.row ? <p className="mt-2 text-sm font-medium text-accent-700">{errors.row}</p> : null}
    </div>
  );
}

/** Save button + result message (only used for staff invitations; that action runs immediately). */
function SaveBar({ onSave, saveLabel = "Kaydet", extra }: { onSave: () => Promise<ActionResult<unknown>>; saveLabel?: string; extra?: ReactNode }) {
  const { pending, feedback, run } = useServerAction();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" disabled={pending} onClick={() => run(onSave)}>
        {pending ? "Kaydediliyor…" : saveLabel}
      </Button>
      {extra}
      <ActionFeedback feedback={feedback} />
    </div>
  );
}

// --- General settings -------------------------------------------------------------

export type GeneralSettingsValues = {
  contactEmail: string;
  contactPhone: string;
  accountHolder: string;
  bankName: string;
  iban: string;
  paymentInstructions: string;
  receiptUploadEnabled: boolean;
  appointmentStartOffsetDays: number;
  appointmentWindowDays: number;
  appointmentIncludeWeekends: boolean;
  appointmentExcludedDates: string;
  /** Retention period for closed applications (months); empty: automatic deletion is off. */
  retentionMonths: string;
  /** Number of extra documents a customer can send after submission. */
  extraDocumentLimit: number;
};

const GENERAL = "general";

export function GeneralSettingsForm({ initial }: { initial: GeneralSettingsValues }) {
  const rows = useMemo(() => ({ [GENERAL]: initial }), [initial]);
  const drafts = useDraftRows(rows);
  const v = drafts.value(GENERAL);
  const base = drafts.base(GENERAL) ?? initial;
  const set = <K extends keyof GeneralSettingsValues>(key: K, value: GeneralSettingsValues[K]) => drafts.update(GENERAL, { ...v, [key]: value });
  const errors = errorsOfRow(drafts.errors, GENERAL).fields;
  const changedFields = (Object.keys(v) as (keyof GeneralSettingsValues)[]).filter((key) => !Object.is(v[key], base[key])).length;

  const save = async () => {
    const sent = { [GENERAL]: v };
    const result = await saveGeneralSettingsAction(v);
    // This action returns field errors keyed by field name; they are converted to the row format (nothing is written on a validation error).
    drafts.settle(
      result.ok || !result.fieldErrors
        ? result
        : { ...result, fieldErrors: Object.fromEntries(Object.entries(result.fieldErrors).map(([key, message]) => [rowFieldErrorKey(GENERAL, key), message])) },
      sent,
    );
    return result;
  };

  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="text-base font-semibold text-ink">Ödeme (banka havalesi) bilgileri</legend>
        <p className="mt-1 text-sm text-muted">Bu bilgiler, başvurusunu göndermiş müşterilere ödeme ekranında gösterilir. Boş bırakılırsa müşteriye “bilgiler henüz tanımlanmadı” notu gösterilir.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="accountHolder" label="Hesap sahibi" error={errors.accountHolder}>
            <Input id="accountHolder" value={v.accountHolder} maxLength={160} onChange={(e) => set("accountHolder", e.target.value)} {...invalidProps("accountHolder", errors.accountHolder)} />
          </Field>
          <Field id="bankName" label="Banka" error={errors.bankName}>
            <Input id="bankName" value={v.bankName} maxLength={160} onChange={(e) => set("bankName", e.target.value)} {...invalidProps("bankName", errors.bankName)} />
          </Field>
          <Field id="iban" label="IBAN" className="sm:col-span-2" error={errors.iban}>
            <Input id="iban" value={v.iban} maxLength={42} autoCapitalize="characters" onChange={(e) => set("iban", e.target.value)} {...invalidProps("iban", errors.iban)} />
          </Field>
          <Field id="paymentInstructions" label="Ödeme talimatları" hint="Müşteriye Ücret adımında ve başvuru sayfasında gösterilir (ör. havale açıklamasına ne yazılacağı). Boş bırakılabilir." className="sm:col-span-2" error={errors.paymentInstructions}>
            <Textarea
              id="paymentInstructions"
              value={v.paymentInstructions}
              maxLength={1500}
              rows={3}
              onChange={(e) => set("paymentInstructions", e.target.value)}
              {...invalidProps("paymentInstructions", errors.paymentInstructions, true)}
            />
          </Field>
          <Checkbox
            id="receiptUploadEnabled"
            className="sm:col-span-2"
            checked={v.receiptUploadEnabled}
            onChange={(e) => set("receiptUploadEnabled", e.target.checked)}
            label="Müşteriler banka dekontu yükleyebilsin"
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-base font-semibold text-ink">İletişim bilgileri</legend>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="contactEmail" label="İletişim e-postası" error={errors.contactEmail}>
            <Input id="contactEmail" type="email" value={v.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} {...invalidProps("contactEmail", errors.contactEmail)} />
          </Field>
          <Field id="contactPhone" label="İletişim telefonu" error={errors.contactPhone}>
            <Input id="contactPhone" type="tel" value={v.contactPhone} maxLength={40} onChange={(e) => set("contactPhone", e.target.value)} {...invalidProps("contactPhone", errors.contactPhone)} />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-base font-semibold text-ink">Gönderimden sonra ek evrak</legend>
        <p className="mt-1 text-sm text-muted">
          Müşteri başvurusunu gönderdikten sonra Evraklar sayfasından, izin istemeden ek evrak gönderebilir. Gönderimde yüklediği belgeleri
          değiştiremez; gönderdiği ek evrakı silemez. Başvuru sonuçlanınca veya iptal edilince ek evrak gönderilemez.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            id="extraDocumentLimit"
            label="Başvuru başına en fazla ek evrak"
            hint={`0: ek evrak gönderimi kapalı. En fazla ${MAX_EXTRA_DOCUMENT_LIMIT}.`}
            error={errors.extraDocumentLimit}
          >
            <Input
              id="extraDocumentLimit"
              type="number"
              min={0}
              max={MAX_EXTRA_DOCUMENT_LIMIT}
              value={v.extraDocumentLimit}
              onChange={(e) => set("extraDocumentLimit", Number(e.target.value))}
              {...invalidProps("extraDocumentLimit", errors.extraDocumentLimit, true)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-base font-semibold text-ink">Kapanan başvuruların saklama süresi</legend>
        <p className="mt-1 text-sm text-muted">
          Sonuçlanan veya iptal edilen başvurular, kapanmalarının üzerinden burada yazan süre geçince kendiliğinden ve kalıcı olarak silinir:
          belgeler, form cevapları, mesajlar, notlar ve görevler. İşlem geçmişinde yalnızca başvuru numarası kalır; müşterinin hesabı silinmez.
          Süreyi hukuk danışmanınızla belirleyiniz; boş bırakılırsa hiçbir başvuru otomatik silinmez.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="retentionMonths" label="Saklama süresi (ay)" hint="Boş: otomatik silme kapalı. Örn. 24" error={errors.retentionMonths}>
            <Input
              id="retentionMonths"
              type="number"
              min={1}
              max={240}
              value={v.retentionMonths}
              onChange={(e) => set("retentionMonths", e.target.value)}
              {...invalidProps("retentionMonths", errors.retentionMonths, true)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-base font-semibold text-ink">Randevu tercihi penceresi</legend>
        <p className="mt-1 text-sm text-muted">
          Müşteri, bugünden “başlangıç” gün sonra başlayan aralıktan en az bir, en fazla üç tercih seçer. Hafta sonları ve hariç tutulan
          tarihler pencereyi uzatmaz, yalnızca seçenekten çıkarılır.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="appointmentStartOffsetDays" label="Başlangıç (bugünden kaç gün sonra)" hint="0: bugün dahil, 1: yarından itibaren." error={errors.appointmentStartOffsetDays}>
            <Input
              id="appointmentStartOffsetDays"
              type="number"
              min={0}
              max={30}
              value={v.appointmentStartOffsetDays}
              onChange={(e) => set("appointmentStartOffsetDays", Number(e.target.value))}
              {...invalidProps("appointmentStartOffsetDays", errors.appointmentStartOffsetDays, true)}
            />
          </Field>
          <Field
            id="appointmentWindowDays"
            label="Seçilebilir gün sayısı"
            hint="Müşteriye sunulan gün sayısı. Hafta sonları (kapalıysa) ve hariç tutulan tarihler sayılmaz; pencere onların yerine uzar."
            error={errors.appointmentWindowDays}
          >
            <Input
              id="appointmentWindowDays"
              type="number"
              min={1}
              max={60}
              value={v.appointmentWindowDays}
              onChange={(e) => set("appointmentWindowDays", Number(e.target.value))}
              {...invalidProps("appointmentWindowDays", errors.appointmentWindowDays)}
            />
          </Field>
          <Checkbox
            id="appointmentIncludeWeekends"
            className="sm:col-span-2"
            checked={v.appointmentIncludeWeekends}
            onChange={(e) => set("appointmentIncludeWeekends", e.target.checked)}
            label="Cumartesi ve pazar günleri seçilebilsin"
          />
          <Field
            id="appointmentExcludedDates"
            label="Hariç tutulan tarihler (resmi tatiller vb.)"
            hint="Her satıra bir tarih, YYYY-AA-GG biçiminde. Örn. 2026-10-29"
            className="sm:col-span-2"
            error={errors.appointmentExcludedDates}
          >
            <Textarea
              id="appointmentExcludedDates"
              value={v.appointmentExcludedDates}
              rows={3}
              onChange={(e) => set("appointmentExcludedDates", e.target.value)}
              {...invalidProps("appointmentExcludedDates", errors.appointmentExcludedDates, true)}
            />
          </Field>
        </div>
      </fieldset>

      <UnsavedChanges count={changedFields} onSave={save} onDiscard={drafts.discard} />
    </div>
  );
}

// --- Appointment cities ----------------------------------------------------------

type CityDraft = { name: string; surchargeAmount: string; surchargeCurrency: string; isActive: boolean };
export type CityValues = { id: string; name: string; surchargeAmount: number; surchargeCurrency: Currency; isActive: boolean };

const NEW_CITY: CityDraft = { name: "", surchargeAmount: "", surchargeCurrency: "TRY", isActive: true };

/** How a stored amount looks in the edit field: 0 → empty, 1250.5 → "1.250,5". */
function surchargeText(amount: number): string {
  return amount > 0 ? formatMoneyTr(String(amount)) : "";
}

/** "Sil" (delete) on an existing row (applies immediately), "Kaldır" (remove) on a new row (discards the unsaved row). */
function RemoveNewRowButton({ onRemove }: { onRemove: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onRemove}>
      Kaldır
    </Button>
  );
}

function CityRow({
  rowKey,
  value,
  onChange,
  state,
  errors,
  action,
}: {
  rowKey: string;
  value: CityDraft;
  onChange: (next: CityDraft) => void;
  state: RowState;
  errors: RowErrors;
  action: ReactNode;
}) {
  const nameId = `city-name-${rowKey}`;
  const amountId = `city-surcharge-${rowKey}`;
  const currencyId = `city-currency-${rowKey}`;
  return (
    <RowFrame state={state} errors={errors}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem]">
        <Field id={nameId} label="Şehir" error={errors.fields.name}>
          <Input
            id={nameId}
            value={value.name}
            maxLength={80}
            // So a new row opened with "Şehir ekle" (add city) can be typed into right away.
            autoFocus={state === "new"}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            {...invalidProps(nameId, errors.fields.name)}
          />
        </Field>
        <Field id={amountId} label="Ek ücret" hint="Yoksa boş bırakınız." error={errors.fields.surchargeAmount}>
          <Input
            id={amountId}
            inputMode="decimal"
            value={value.surchargeAmount}
            maxLength={24}
            placeholder="0"
            onChange={(e) => onChange({ ...value, surchargeAmount: e.target.value })}
            {...invalidProps(amountId, errors.fields.surchargeAmount, true)}
          />
        </Field>
        <Field id={currencyId} label="Para birimi" error={errors.fields.surchargeCurrency}>
          <Select
            id={currencyId}
            value={value.surchargeCurrency}
            onChange={(e) => onChange({ ...value, surchargeCurrency: e.target.value })}
            {...invalidProps(currencyId, errors.fields.surchargeCurrency)}
          >
            {CURRENCIES_BY_LABEL.map((currency) => (
              <option key={currency} value={currency}>
                {CURRENCY_LABELS[currency]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Checkbox id={`city-active-${rowKey}`} checked={value.isActive} onChange={(e) => onChange({ ...value, isActive: e.target.checked })} label="Etkin (müşteri seçebilir)" />
        {action}
      </div>
    </RowFrame>
  );
}

/** Cities in the order set with "Sırayı değiştir"; without an order, İstanbul and Ankara first, the rest alphabetical. */
export function CitiesManager({ items }: { items: CityValues[] }) {
  const rows = useMemo(() => {
    const record: Record<string, CityDraft> = {};
    for (const item of items) {
      record[item.id] = { name: item.name, surchargeAmount: surchargeText(item.surchargeAmount), surchargeCurrency: item.surchargeCurrency, isActive: item.isActive };
    }
    return record;
  }, [items]);
  const drafts = useDraftRows(rows);

  const save = async () => {
    const { sent, updates, creates } = drafts.collect();
    const result = await saveCitiesAction({ updates, creates });
    drafts.settle(result, sent);
    return result;
  };

  const row = (key: string, state: RowState, action: ReactNode) => (
    <CityRow
      key={key}
      rowKey={key}
      value={drafts.value(key)}
      onChange={(next) => drafts.update(key, next)}
      state={state}
      errors={errorsOfRow(drafts.errors, key)}
      action={action}
    />
  );

  return (
    <div className="space-y-3">
      {items.length === 0 && drafts.added.length === 0 ? (
        <p className="text-sm text-muted">Şehir tanımlanmadı. Şehir tanımlanmadığı sürece müşteriye randevu şehri sorulmaz.</p>
      ) : null}
      {items.map((item) =>
        row(
          item.id,
          drafts.isChanged(item.id) ? "changed" : "saved",
          <ActionButton
            variant="ghost"
            size="sm"
            action={deleteCityAction.bind(null, item.id)}
            confirm={{ title: "Şehir silinsin mi?", description: "Bu şehri seçmiş başvurularda randevu şehri boşalır. Bu işlem hemen uygulanır.", confirmLabel: "Sil", tone: "delete" }}
          >
            Sil
          </ActionButton>,
        ),
      )}
      {drafts.added.map(({ key }) => row(key, "new", <RemoveNewRowButton onRemove={() => drafts.removeRow(key)} />))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={() => drafts.addRow(NEW_CITY)}>
          <Plus aria-hidden className="size-4" />
          Şehir ekle
        </Button>
        <ReorderButton
          list="cities"
          items={items.map((item) => ({ id: item.id, label: item.name, note: item.isActive ? undefined : "Etkin değil" }))}
          title="Şehirlerin sırası"
          description="Müşteri şehirleri bu sırayla görür. Satırı tutup sürükleyiniz veya oklarla taşıyınız."
        />
      </div>
      <UnsavedChanges count={drafts.count} onSave={save} onDiscard={drafts.discard} />
    </div>
  );
}

// --- ZIP folders ------------------------------------------------------------------

// --- Appointment locations --------------------------------------------------------
// When sending the appointment date the consultant picks the location from this list; its name and address are shown to the customer.

type AppointmentLocationDraft = { name: string; address: string; mapsUrl: string; isActive: boolean };
export type AppointmentLocationValues = { id: string; name: string; address: string; mapsUrl: string; isActive: boolean };

const NEW_APPOINTMENT_LOCATION: AppointmentLocationDraft = { name: "", address: "", mapsUrl: "", isActive: true };

function AppointmentLocationRow({
  rowKey,
  value,
  onChange,
  state,
  errors,
  action,
}: {
  rowKey: string;
  value: AppointmentLocationDraft;
  onChange: (next: AppointmentLocationDraft) => void;
  state: RowState;
  errors: RowErrors;
  action: ReactNode;
}) {
  const nameId = `location-name-${rowKey}`;
  const addressId = `location-address-${rowKey}`;
  const mapsId = `location-maps-${rowKey}`;
  return (
    <RowFrame state={state} errors={errors}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Field id={nameId} label="Yerin adı" error={errors.fields.name}>
          <Input
            id={nameId}
            value={value.name}
            maxLength={120}
            autoFocus={state === "new"}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            {...invalidProps(nameId, errors.fields.name)}
          />
        </Field>
        <Field id={addressId} label="Adres" error={errors.fields.address}>
          <Textarea
            id={addressId}
            value={value.address}
            maxLength={400}
            rows={2}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
            {...invalidProps(addressId, errors.fields.address)}
          />
        </Field>
        <Field
          id={mapsId}
          label="Google Haritalar bağlantısı (isteğe bağlı)"
          hint="Google Haritalar'da yeri açıp “Paylaş” → “Bağlantıyı kopyala” ile alınır. Müşterinin “Haritada aç” düğmesi bu bağlantıyı açar; boşsa düğme görünmez."
          error={errors.fields.mapsUrl}
          className="sm:col-span-2"
        >
          <Input
            id={mapsId}
            type="url"
            inputMode="url"
            value={value.mapsUrl}
            maxLength={2000}
            placeholder="https://maps.app.goo.gl/…"
            onChange={(e) => onChange({ ...value, mapsUrl: e.target.value })}
            {...invalidProps(mapsId, errors.fields.mapsUrl, true)}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Checkbox
          id={`location-active-${rowKey}`}
          checked={value.isActive}
          onChange={(e) => onChange({ ...value, isActive: e.target.checked })}
          label="Etkin (randevu bildirirken seçilebilir)"
        />
        {action}
      </div>
    </RowFrame>
  );
}

/** Appointment locations in the order set with "Sırayı değiştir"; alphabetical without an order. */
export function AppointmentLocationsManager({ items }: { items: AppointmentLocationValues[] }) {
  const rows = useMemo(() => {
    const record: Record<string, AppointmentLocationDraft> = {};
    for (const item of items) record[item.id] = { name: item.name, address: item.address, mapsUrl: item.mapsUrl, isActive: item.isActive };
    return record;
  }, [items]);
  const drafts = useDraftRows(rows);

  const save = async () => {
    const { sent, updates, creates } = drafts.collect();
    const result = await saveAppointmentLocationsAction({ updates, creates });
    drafts.settle(result, sent);
    return result;
  };

  const row = (key: string, state: RowState, action: ReactNode) => (
    <AppointmentLocationRow
      key={key}
      rowKey={key}
      value={drafts.value(key)}
      onChange={(next) => drafts.update(key, next)}
      state={state}
      errors={errorsOfRow(drafts.errors, key)}
      action={action}
    />
  );

  return (
    <div className="space-y-3">
      {items.length === 0 && drafts.added.length === 0 ? (
        <p className="text-sm text-muted">Randevu yeri tanımlanmadı. Randevu tarihi bildirmek için en az bir yer ekleyiniz.</p>
      ) : null}
      {items.map((item) =>
        row(
          item.id,
          drafts.isChanged(item.id) ? "changed" : "saved",
          <ActionButton
            variant="ghost"
            size="sm"
            action={deleteAppointmentLocationAction.bind(null, item.id)}
            confirm={{
              title: "Randevu yeri silinsin mi?",
              description: "Bu yer listeden kalkar. Bu yerle daha önce bildirilmiş randevuların bilgisi değişmez. Bu işlem hemen uygulanır.",
              confirmLabel: "Sil",
              tone: "delete",
            }}
          >
            Sil
          </ActionButton>,
        ),
      )}
      {drafts.added.map(({ key }) => row(key, "new", <RemoveNewRowButton onRemove={() => drafts.removeRow(key)} />))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={() => drafts.addRow(NEW_APPOINTMENT_LOCATION)}>
          <Plus aria-hidden className="size-4" />
          Yer ekle
        </Button>
        <ReorderButton
          list="appointment_locations"
          items={items.map((item) => ({ id: item.id, label: item.name, note: item.isActive ? undefined : "Etkin değil" }))}
          title="Randevu yerlerinin sırası"
          description="Randevu bildirirken yerler bu sırayla listelenir. Satırı tutup sürükleyiniz veya oklarla taşıyınız."
        />
      </div>
      <UnsavedChanges count={drafts.count} onSave={save} onDiscard={drafts.discard} />
    </div>
  );
}

type ZipDraft = { folderName: string; isActive: boolean };
export type ZipCategoryValues = { id: string; documentCount: number } & ZipDraft;

const NEW_ZIP_FOLDER: ZipDraft = { folderName: "", isActive: true };

function ZipCategoryRow({
  rowKey,
  value,
  onChange,
  state,
  errors,
  documentCount,
  action,
}: {
  rowKey: string;
  value: ZipDraft;
  onChange: (next: ZipDraft) => void;
  state: RowState;
  errors: RowErrors;
  documentCount?: number;
  action: ReactNode;
}) {
  const nameId = `zip-name-${rowKey}`;
  const hasHint = documentCount !== undefined;
  return (
    <RowFrame state={state} errors={errors}>
      <Field id={nameId} label="Klasör adı" hint={hasHint ? `${documentCount} belge tipi bu klasöre eşleştirilmiş.` : undefined} error={errors.fields.folderName}>
        <Input
          id={nameId}
          value={value.folderName}
          maxLength={60}
          // So a new row opened with "Klasör ekle" (add folder) can be typed into right away.
          autoFocus={state === "new"}
          onChange={(e) => onChange({ ...value, folderName: e.target.value })}
          {...invalidProps(nameId, errors.fields.folderName, hasHint)}
        />
      </Field>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Checkbox id={`zip-active-${rowKey}`} checked={value.isActive} onChange={(e) => onChange({ ...value, isActive: e.target.checked })} label="Etkin (ZIP içinde klasör oluşturulur)" />
        {action}
      </div>
    </RowFrame>
  );
}

/** Folders in the order set with "Sırayı değiştir"; alphabetical without an order. */
export function ZipCategoriesManager({ items }: { items: ZipCategoryValues[] }) {
  const rows = useMemo(() => {
    const record: Record<string, ZipDraft> = {};
    for (const item of items) record[item.id] = { folderName: item.folderName, isActive: item.isActive };
    return record;
  }, [items]);
  const drafts = useDraftRows(rows);

  const save = async () => {
    const { sent, updates, creates } = drafts.collect();
    const result = await saveZipCategoriesAction({ updates, creates });
    drafts.settle(result, sent);
    return result;
  };

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ZipCategoryRow
          key={item.id}
          rowKey={item.id}
          value={drafts.value(item.id)}
          onChange={(next) => drafts.update(item.id, next)}
          state={drafts.isChanged(item.id) ? "changed" : "saved"}
          errors={errorsOfRow(drafts.errors, item.id)}
          documentCount={item.documentCount}
          action={
            <ActionButton
              variant="ghost"
              size="sm"
              action={deleteZipCategoryAction.bind(null, item.id)}
              confirm={{
                title: "Klasör silinsin mi?",
                description: `“${item.folderName}” klasörüne eşleştirilmiş ${item.documentCount} belge tipi eşleştirilmemiş hâle gelir ve ZIP'in kök dizinine konulur. Bu işlem hemen uygulanır.`,
                confirmLabel: "Klasörü sil",
                tone: "delete",
              }}
            >
              Sil
            </ActionButton>
          }
        />
      ))}
      {drafts.added.map(({ key }) => (
        <ZipCategoryRow
          key={key}
          rowKey={key}
          value={drafts.value(key)}
          onChange={(next) => drafts.update(key, next)}
          state="new"
          errors={errorsOfRow(drafts.errors, key)}
          action={<RemoveNewRowButton onRemove={() => drafts.removeRow(key)} />}
        />
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={() => drafts.addRow(NEW_ZIP_FOLDER)}>
          <Plus aria-hidden className="size-4" />
          Klasör ekle
        </Button>
        <ReorderButton
          list="zip_categories"
          items={items.map((item) => ({ id: item.id, label: item.folderName, note: item.isActive ? undefined : "Etkin değil" }))}
          title="Klasörlerin sırası"
          description="Ayarlar'daki listelerde klasörler bu sırayla gösterilir. Satırı tutup sürükleyiniz veya oklarla taşıyınız."
        />
      </div>
      <UnsavedChanges count={drafts.count} onSave={save} onDiscard={drafts.discard} />
    </div>
  );
}

// --- Document rules ---------------------------------------------------------------

/** Empty `applicationType` and `sponsorStatus`: shared document / no sponsor status. Only chosen for a new document. */
type DocumentTypeDraft = {
  label: string;
  description: string;
  requirement: DocumentRequirement;
  maxFiles: number;
  zipCategoryId: string | null;
  isActive: boolean;
  applicationType: string;
  sponsorStatus: string;
};

export type DocumentTypeValues = {
  id: string;
  label: string;
  description: string;
  applicationType: ApplicationType | null;
  sponsorStatus: SponsorStatus | null;
  requirement: DocumentRequirement;
  maxFiles: number;
  zipCategoryId: string | null;
  isActive: boolean;
  /** Only required from applicants under 18 (e.g. parental consent letter). */
  minorsOnly: boolean;
};

type DocumentGroup = { applicationType: ApplicationType | null; sponsorStatus: SponsorStatus | null; title: string };

/** Groups are fixed: even if no document is left in a group, documents can be added again with "Bu gruba belge ekle". */
const DOCUMENT_GROUPS: DocumentGroup[] = [
  { applicationType: null, sponsorStatus: null, title: "Ortak evraklar (tüm başvurular)" },
  ...APPLICATION_TYPES.map((type) => ({ applicationType: type, sponsorStatus: null, title: APPLICATION_TYPE_LABELS[type] })),
  ...SPONSOR_STATUSES.map((status) => ({
    applicationType: "sponsored" as const,
    sponsorStatus: status,
    title: `${APPLICATION_TYPE_LABELS.sponsored} — sponsor ${SPONSOR_STATUS_LABELS[status].toLocaleLowerCase("tr-TR")} ise`,
  })),
];

const inGroup = (group: DocumentGroup, applicationType: string | null, sponsorStatus: string | null) =>
  (group.applicationType ?? "") === (applicationType ?? "") && (group.sponsorStatus ?? "") === (sponsorStatus ?? "");

function DocumentTypeRow({
  rowKey,
  value,
  onChange,
  state,
  errors,
  categories,
  minorsOnly,
  action,
  showRequirement = true,
  usage,
}: {
  rowKey: string;
  value: DocumentTypeDraft;
  onChange: (next: DocumentTypeDraft) => void;
  state: RowState;
  errors: RowErrors;
  categories: { id: string; folderName: string }[];
  minorsOnly: boolean;
  action: ReactNode;
  /** Since migration 20 the rule lives in the document rules, not on the document; the field is not shown. */
  showRequirement?: boolean;
  /** Which rules require the document (since migration 20). */
  usage?: ReactNode;
}) {
  const labelId = `dt-label-${rowKey}`;
  const descriptionId = `dt-description-${rowKey}`;
  const requirementId = `dt-req-${rowKey}`;
  const zipId = `dt-zip-${rowKey}`;
  const maxId = `dt-max-${rowKey}`;

  return (
    <RowFrame state={state} errors={errors}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {!value.isActive ? <Badge>Kullanım dışı</Badge> : null}
          {minorsOnly ? <Badge tone="info">Yalnızca 18 yaşından küçük başvuru sahiplerine istenir</Badge> : null}
        </div>
      </div>
      {usage ? <div className="mb-3 text-sm">{usage}</div> : null}
      <div className="grid gap-3">
        <Field id={labelId} label="Belgenin adı" error={errors.fields.label}>
          <Input
            id={labelId}
            value={value.label}
            maxLength={160}
            // So a new row opened with "Bu gruba belge ekle" (add a document to this group) can be typed into right away.
            autoFocus={state === "new"}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            {...invalidProps(labelId, errors.fields.label)}
          />
        </Field>
        <Field id={descriptionId} label="Müşteriye gösterilen açıklama" hint="İsteğe bağlı." error={errors.fields.description}>
          <Textarea
            id={descriptionId}
            rows={2}
            maxLength={600}
            value={value.description}
            onChange={(e) => onChange({ ...value, description: e.target.value })}
            {...invalidProps(descriptionId, errors.fields.description, true)}
          />
        </Field>
      </div>
      <div
        className={cn(
          "mt-3 grid gap-3 sm:grid-cols-2",
          showRequirement ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_7rem]" : "lg:grid-cols-[minmax(0,1.3fr)_7rem]",
        )}
      >
        {showRequirement ? (
          <Field
            id={requirementId}
            label="Kural"
            error={errors.fields.requirement}
          >
            <Select
              id={requirementId}
              value={value.requirement}
              onChange={(e) => onChange({ ...value, requirement: e.target.value as DocumentRequirement })}
              {...invalidProps(requirementId, errors.fields.requirement)}
            >
              {DOCUMENT_REQUIREMENTS.map((requirement) => (
                <option key={requirement} value={requirement}>
                  {DOCUMENT_REQUIREMENT_LABELS[requirement]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field id={zipId} label="ZIP klasörü" error={errors.fields.zipCategoryId}>
          <Select
            id={zipId}
            value={value.zipCategoryId ?? ""}
            onChange={(e) => onChange({ ...value, zipCategoryId: e.target.value || null })}
            {...invalidProps(zipId, errors.fields.zipCategoryId)}
          >
            <option value="">Eşleştirilmemiş (kök dizin)</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.folderName}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={maxId} label="En fazla dosya" error={errors.fields.maxFiles}>
          <Input id={maxId} type="number" min={1} max={30} value={value.maxFiles} onChange={(e) => onChange({ ...value, maxFiles: Number(e.target.value) })} {...invalidProps(maxId, errors.fields.maxFiles)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Checkbox id={`dt-active-${rowKey}`} checked={value.isActive} onChange={(e) => onChange({ ...value, isActive: e.target.checked })} label="Kullanımda (yeni başvurularda istenir)" />
        {action}
      </div>
    </RowFrame>
  );
}

export function DocumentTypesManager({ items, categories }: { items: DocumentTypeValues[]; categories: { id: string; folderName: string }[] }) {
  const rows = useMemo(() => {
    const record: Record<string, DocumentTypeDraft> = {};
    for (const item of items) {
      record[item.id] = {
        label: item.label,
        description: item.description,
        requirement: item.requirement,
        maxFiles: item.maxFiles,
        zipCategoryId: item.zipCategoryId,
        isActive: item.isActive,
        applicationType: item.applicationType ?? "",
        sponsorStatus: item.sponsorStatus ?? "",
      };
    }
    return record;
  }, [items]);
  const drafts = useDraftRows(rows);

  const save = async () => {
    const { sent, updates, creates } = drafts.collect();
    const result = await saveDocumentTypesAction({ updates, creates });
    drafts.settle(result, sent);
    return result;
  };

  return (
    <div className="space-y-8">
      {DOCUMENT_GROUPS.map((group) => {
        const groupItems = items.filter((item) => inGroup(group, item.applicationType, item.sponsorStatus));
        const groupAdded = drafts.added.filter(({ value }) => inGroup(group, value.applicationType, value.sponsorStatus));
        return (
          <section key={group.title}>
            <h3 className="mb-3 text-base font-semibold text-ink">{group.title}</h3>
            <div className="space-y-3">
              {groupItems.length === 0 && groupAdded.length === 0 ? <p className="text-sm text-muted">Bu grupta belge yok.</p> : null}
              {groupItems.map((item) => (
                <DocumentTypeRow
                  key={item.id}
                  rowKey={item.id}
                  value={drafts.value(item.id)}
                  onChange={(next) => drafts.update(item.id, next)}
                  state={drafts.isChanged(item.id) ? "changed" : "saved"}
                  errors={errorsOfRow(drafts.errors, item.id)}
                  categories={categories}
                  minorsOnly={item.minorsOnly}
                  action={
                    <ActionButton
                      variant="ghost"
                      size="sm"
                      action={deleteDocumentTypeAction.bind(null, item.id)}
                      confirm={{
                        title: "Belge silinsin mi?",
                        description: `“${item.label}” yeni başvurularda istenmez ve listeden kaldırılır; taslak başvurulardaki boş yuvası da kaldırılır. Gönderilmiş bir başvuruda veya dosya yüklenmiş bir taslakta kullanılıyorsa dosyalar korunur ve belge yalnızca kullanım dışı bırakılır. Bu işlem hemen uygulanır.`,
                        confirmLabel: "Belgeyi sil",
                        tone: "delete",
                      }}
                    >
                      Sil
                    </ActionButton>
                  }
                />
              ))}
              {groupAdded.map(({ key }) => (
                <DocumentTypeRow
                  key={key}
                  rowKey={key}
                  value={drafts.value(key)}
                  onChange={(next) => drafts.update(key, next)}
                  state="new"
                  errors={errorsOfRow(drafts.errors, key)}
                  categories={categories}
                  minorsOnly={false}
                  action={<RemoveNewRowButton onRemove={() => drafts.removeRow(key)} />}
                />
              ))}
              <div className="pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    drafts.addRow({
                      label: "",
                      description: "",
                      requirement: "required",
                      maxFiles: 10,
                      zipCategoryId: null,
                      isActive: true,
                      applicationType: group.applicationType ?? "",
                      sponsorStatus: group.sponsorStatus ?? "",
                    })
                  }
                >
                  <Plus aria-hidden className="size-4" />
                  Bu gruba belge ekle
                </Button>
              </div>
            </div>
          </section>
        );
      })}
      <UnsavedChanges count={drafts.count} onSave={save} onDiscard={drafts.discard} />
    </div>
  );
}

/**
 * Document list (since migration 20): all documents in one list, in the order shown to the customer. Which application
 * requires a document and with which rule is in the "Kurallar" (rules) section (document-rules-manager.tsx); only the document
 * itself (name, description, ZIP folder, number of files, usage) is edited here.
 */
export function DocumentCatalogManager({
  items,
  categories,
  usage,
}: {
  items: DocumentTypeValues[];
  categories: { id: string; folderName: string }[];
  /** Document id → names of the rules containing the document. */
  usage: Record<string, string[]>;
}) {
  const rows = useMemo(() => {
    const record: Record<string, DocumentTypeDraft> = {};
    for (const item of items) {
      record[item.id] = {
        label: item.label,
        description: item.description,
        requirement: item.requirement,
        maxFiles: item.maxFiles,
        zipCategoryId: item.zipCategoryId,
        isActive: item.isActive,
        applicationType: "",
        sponsorStatus: "",
      };
    }
    return record;
  }, [items]);
  const drafts = useDraftRows(rows);

  const save = async () => {
    const { sent, updates, creates } = drafts.collect();
    const result = await saveDocumentCatalogAction({ updates, creates });
    drafts.settle(result, sent);
    return result;
  };

  const usageLine = (id: string) => {
    const titles = usage[id] ?? [];
    return titles.length > 0 ? (
      <p className="text-muted">
        <span className="font-semibold text-ink">İstendiği kurallar:</span> {titles.join(" · ")}
      </p>
    ) : (
      <p className="font-semibold text-accent-700">Hiçbir kuralda yok: bu belge müşteriden istenmez. Aşağıdaki kurallardan birine ekleyiniz.</p>
    );
  };

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <DocumentTypeRow
          key={item.id}
          rowKey={item.id}
          value={drafts.value(item.id)}
          onChange={(next) => drafts.update(item.id, next)}
          state={drafts.isChanged(item.id) ? "changed" : "saved"}
          errors={errorsOfRow(drafts.errors, item.id)}
          categories={categories}
          minorsOnly={item.minorsOnly}
          showRequirement={false}
          usage={usageLine(item.id)}
          action={
            <ActionButton
              variant="ghost"
              size="sm"
              action={deleteDocumentTypeAction.bind(null, item.id)}
              confirm={{
                title: "Belge silinsin mi?",
                description: `“${item.label}” yeni başvurularda istenmez ve listeden kaldırılır; taslak başvurulardaki boş yuvası da kaldırılır. Gönderilmiş bir başvuruda veya dosya yüklenmiş bir taslakta kullanılıyorsa dosyalar korunur ve belge yalnızca kullanım dışı bırakılır. Bu işlem hemen uygulanır.`,
                confirmLabel: "Belgeyi sil",
                tone: "delete",
              }}
            >
              Sil
            </ActionButton>
          }
        />
      ))}
      {drafts.added.map(({ key }) => (
        <DocumentTypeRow
          key={key}
          rowKey={key}
          value={drafts.value(key)}
          onChange={(next) => drafts.update(key, next)}
          state="new"
          errors={errorsOfRow(drafts.errors, key)}
          categories={categories}
          minorsOnly={false}
          showRequirement={false}
          usage={<p className="text-muted">Kaydettikten sonra belgeyi aşağıdaki kurallardan birine ekleyiniz; eklenmedikçe müşteriden istenmez.</p>}
          action={<RemoveNewRowButton onRemove={() => drafts.removeRow(key)} />}
        />
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            drafts.addRow({ label: "", description: "", requirement: "required", maxFiles: 10, zipCategoryId: null, isActive: true, applicationType: "", sponsorStatus: "" })
          }
        >
          <Plus aria-hidden className="size-4" />
          Belge ekle
        </Button>
        <ReorderButton
          list="document_types"
          items={items.map((item) => ({ id: item.id, label: item.label, note: item.isActive ? undefined : "Kullanım dışı" }))}
          title="Belgelerin sırası"
          description="Müşterinin Evraklar sayfasında belgeler bu sırayla gösterilir. Satırı tutup sürükleyiniz veya oklarla taşıyınız."
        />
      </div>
      <UnsavedChanges count={drafts.count} onSave={save} onDiscard={drafts.discard} />
    </div>
  );
}

// --- Staff ----------------------------------------------------------------------

export function StaffInviteForm() {
  const [v, setV] = useState({ email: "", firstName: "", lastName: "" });
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="invite-first" label="Ad">
          <Input id="invite-first" value={v.firstName} maxLength={80} onChange={(e) => setV({ ...v, firstName: e.target.value })} />
        </Field>
        <Field id="invite-last" label="Soyad">
          <Input id="invite-last" value={v.lastName} maxLength={80} onChange={(e) => setV({ ...v, lastName: e.target.value })} />
        </Field>
        <Field id="invite-email" label="E-posta adresi">
          <Input id="invite-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3">
        <SaveBar
          saveLabel="Davet gönder"
          onSave={async () => {
            const result = await inviteStaffAction(v);
            if (result.ok) setV({ email: "", firstName: "", lastName: "" });
            return result;
          }}
        />
      </div>
    </div>
  );
}

/** Resets another consultant's two-factor authentication (if they lost their phone); they set it up again at next sign-in. */
export function ResetMfaButton({ userId, name }: { userId: string; name: string }) {
  return (
    <ActionButton
      variant="secondary"
      size="sm"
      action={resetStaffMfaAction.bind(null, userId)}
      confirm={{
        title: "İki adımlı doğrulama sıfırlansın mı?",
        description: `${name} bir sonraki girişinde doğrulama uygulamasını yeniden kuracak. Bunu yalnızca kişi telefonunu kaybettiyse veya değiştirdiyse yapınız. İşlem geçmişine kaydedilir.`,
        confirmLabel: "Sıfırla",
      }}
    >
      Doğrulamayı sıfırla
    </ActionButton>
  );
}

/** Grant/revoke admin rights (only visible to admins; the server and the database check too). */
export function StaffAdminButton({ userId, name, isAdmin }: { userId: string; name: string; isAdmin: boolean }) {
  return (
    <ActionButton
      variant="secondary"
      size="sm"
      action={setStaffAdminAction.bind(null, userId, !isAdmin)}
      confirm={
        isAdmin
          ? {
              title: "Yöneticilik kaldırılsın mı?",
              description: `${name} artık personel davet edemeyecek, erişim açıp kapatamayacak ve doğrulama sıfırlayamayacak. Başvurularla ilgili işlemleri yapmaya devam eder.`,
              confirmLabel: "Yöneticiliği kaldır",
            }
          : {
              title: "Yönetici yapılsın mı?",
              description: `${name} personel davet edebilecek, personelin erişimini açıp kapatabilecek, iki adımlı doğrulamayı sıfırlayabilecek ve başkalarını yönetici yapabilecek.`,
              confirmLabel: "Yönetici yap",
            }
      }
    >
      {isAdmin ? "Yöneticiliği kaldır" : "Yönetici yap"}
    </ActionButton>
  );
}

export function StaffAccessButton({ userId, name, isActive }: { userId: string; name: string; isActive: boolean }) {
  return (
    <ActionButton
      variant={isActive ? "danger" : "secondary"}
      size="sm"
      action={setStaffActiveAction.bind(null, userId, !isActive)}
      confirm={
        isActive
          ? {
              title: "Erişim kapatılsın mı?",
              description: `${name} artık yönetim paneline giremeyecek ve hiçbir başvuruyu göremeyecek. Yaptığı işlemlerin kayıtları korunur.`,
              confirmLabel: "Erişimi kapat",
            }
          : { title: "Erişim yeniden açılsın mı?", description: `${name} yeniden tüm başvurulara erişebilecek.`, confirmLabel: "Erişimi aç" }
      }
    >
      {isActive ? "Erişimi kapat" : "Erişimi aç"}
    </ActionButton>
  );
}

/** Deletes a staff member permanently. It cannot be undone; the warning says so clearly. */
export function StaffDeleteButton({ userId, name }: { userId: string; name: string }) {
  return (
    <ActionButton
      variant="danger"
      size="sm"
      action={deleteStaffAction.bind(null, userId)}
      confirm={{
        title: "Personel hesabı kalıcı olarak silinsin mi?",
        description: (
          <>
            <strong>{name}</strong> adlı kişinin hesabı silinir: bir daha giriş yapamaz ve personel listesinden kalkar.{" "}
            <strong>Bu işlem geri alınamaz.</strong> Kişinin işlem geçmişi ve iç notları silinmez; adı “(silinmiş personel)” ekiyle görünür.
            Yalnızca erişimini geçici olarak kesmek istiyorsanız bunun yerine “Erişimi kapat”ı kullanınız. Aynı e-posta adresine sonradan
            yeniden davet gönderilebilir.
          </>
        ),
        confirmLabel: "Kalıcı olarak sil",
        tone: "delete",
      }}
    >
      Personeli sil
    </ActionButton>
  );
}
