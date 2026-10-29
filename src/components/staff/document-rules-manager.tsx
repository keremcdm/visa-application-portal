"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { ActionButton, useServerAction } from "@/components/ui/action-button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge, Button } from "@/components/ui/primitives";
import {
  combinationError,
  normalizeApplicationTypes,
  requiredDocuments,
  ruleTitle,
  type DocumentRule,
} from "@/features/documents/document-rules";
import {
  APPLICATION_TYPE_LABELS,
  APPLICATION_TYPES_BY_LABEL,
  DOCUMENT_REQUIREMENT_LABELS,
  DOCUMENT_REQUIREMENTS,
  SPONSOR_STATUS_LABELS,
  SPONSOR_STATUSES,
  type ApplicationType,
  type DocumentRequirement,
  type SponsorStatus,
} from "@/lib/domain/constants";
import {
  deleteDocumentRuleAction,
  saveDocumentRuleAction,
} from "@/server/actions/settings";
import { AdminModal, ModalClose, ResultMessage } from "./admin/admin-modal";
import { adminButton } from "./admin/ui";

/*
 * DOCUMENT RULES
 * For an application type or a combination of types (e.g. "Öğrenci", "Öğrenci + Sponsorlu") the admin chooses which
 * documents are required and with which rule. Rule logic: src/features/documents/document-rules.ts. Saving a rule applies
 * immediately; it is not tied to the "Kaydet" bar at the bottom of the page.
 */

export type RuleDocument = {
  id: string;
  label: string;
  isActive: boolean;
  minorsOnly: boolean;
};

/** By strictness: required, optional. */
const REQUIREMENT_ORDER: DocumentRequirement[] = [
  ...DOCUMENT_REQUIREMENTS,
].reverse();

const REQUIREMENT_TONE: Record<
  DocumentRequirement,
  "danger" | "neutral"
> = { required: "danger", optional: "neutral" };

function RuleEditor({
  rule,
  rules,
  documents,
}: {
  rule: DocumentRule | null;
  rules: DocumentRule[];
  documents: RuleDocument[];
}) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<ApplicationType[]>([]);
  const [sponsor, setSponsor] = useState<SponsorStatus | "">("");
  const [items, setItems] = useState<Record<string, DocumentRequirement>>({});
  const [filter, setFilter] = useState("");
  const { pending, feedback, run, setFeedback } = useServerAction();
  const idBase = rule ? `rule-${rule.id}` : "rule-new";

  const openChange = (next: boolean) => {
    if (next) {
      setTypes(rule?.applicationTypes ?? []);
      setSponsor(rule?.sponsorStatus ?? "");
      setItems(
        Object.fromEntries(
          (rule?.items ?? []).map((item) => [
            item.documentTypeId,
            item.requirement,
          ]),
        ),
      );
      setFilter("");
      setFeedback(null);
    }
    setOpen(next);
  };

  const toggleType = (type: ApplicationType, checked: boolean) => {
    const next = checked
      ? normalizeApplicationTypes([...types, type])
      : types.filter((t) => t !== type);
    setTypes(next);
    if (!next.includes("sponsored")) setSponsor("");
  };

  const problem = combinationError(
    {
      id: rule?.id ?? null,
      applicationTypes: types,
      sponsorStatus: sponsor || null,
    },
    rules,
  );
  const needle = filter.trim().toLocaleLowerCase("tr-TR");
  const visible = documents.filter(
    (doc) =>
      needle === "" || doc.label.toLocaleLowerCase("tr-TR").includes(needle),
  );
  const selectedCount = Object.keys(items).length;

  const save = () =>
    run(
      () =>
        saveDocumentRuleAction({
          id: rule?.id ?? null,
          applicationTypes: types,
          sponsorStatus: sponsor || null,
          // Sent in document catalogue order.
          items: documents
            .filter((doc) => items[doc.id])
            .map((doc) => ({
              documentTypeId: doc.id,
              requirement: items[doc.id]!,
            })),
        }),
      () => setOpen(false),
    );

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => openChange(true)}>
        {rule ? (
          <Pencil aria-hidden className="size-4" />
        ) : (
          <Plus aria-hidden className="size-4" />
        )}
        {rule ? "Düzenle" : "Kural ekle"}
      </Button>
      <AdminModal
        open={open}
        onOpenChange={openChange}
        title={rule ? "Kuralı düzenle" : "Yeni kural"}
        description="Kural, aşağıda seçtiğiniz başvuru tiplerinin HEPSİNİ seçen müşterilere uygulanır. Hiçbir tip seçmezseniz kural bütün başvurulara uygulanır."
        footer={
          <>
            <ModalClose
              className={adminButton("secondary", "md", "h-[42px] px-[18px]")}
            >
              Vazgeç
            </ModalClose>
            <button
              type="button"
              className={adminButton("primary", "md", "h-[42px] px-[18px]")}
              disabled={pending || problem !== null}
              onClick={save}
            >
              {pending ? "Kaydediliyor…" : "Kuralı kaydet"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <fieldset>
            <legend className="mb-2 text-sm font-bold text-dash-navy">
              Başvuru tipleri
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {APPLICATION_TYPES_BY_LABEL.map((type) => (
                <Checkbox
                  key={type}
                  id={`${idBase}-type-${type}`}
                  checked={types.includes(type)}
                  onChange={(e) => toggleType(type, e.target.checked)}
                  label={APPLICATION_TYPE_LABELS[type]}
                />
              ))}
            </div>
            <p className="mt-2 text-sm text-dash-ink-2">
              Bu kural:{" "}
              <strong className="text-dash-navy">
                {ruleTitle({
                  applicationTypes: types,
                  sponsorStatus: sponsor || null,
                })}
              </strong>
            </p>
          </fieldset>

          {types.includes("sponsored") ? (
            <Field
              id={`${idBase}-sponsor`}
              label="Sponsorun durumu"
              hint="“Fark etmez” seçilirse kural, sponsorun durumu ne olursa olsun uygulanır."
            >
              <Select
                id={`${idBase}-sponsor`}
                value={sponsor}
                aria-describedby={`${idBase}-sponsor-hint`}
                onChange={(e) =>
                  setSponsor(
                    SPONSOR_STATUSES.find((s) => s === e.target.value) ?? "",
                  )
                }
              >
                <option value="">Fark etmez</option>
                {SPONSOR_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {SPONSOR_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {problem ? (
            <p role="alert" className="text-sm font-semibold text-accent-700">
              {problem}
            </p>
          ) : null}

          <fieldset>
            <legend className="mb-2 text-sm font-bold text-dash-navy">
              İstenecek belgeler ({selectedCount} seçili)
            </legend>
            <Field id={`${idBase}-filter`} label="Belge ara">
              <Input
                id={`${idBase}-filter`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Ör. pasaport"
              />
            </Field>
            <ul className="mt-3 flex max-h-[45vh] flex-col divide-y divide-dash-line-soft overflow-y-auto rounded-md border border-dash-line-strong">
              {visible.length === 0 ? (
                <li className="p-3 text-sm text-dash-ink-2">
                  Aramaya uyan belge yok.
                </li>
              ) : null}
              {visible.map((doc) => {
                const requirement = items[doc.id];
                const selectId = `${idBase}-req-${doc.id}`;
                return (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <Checkbox
                      id={`${idBase}-doc-${doc.id}`}
                      checked={requirement !== undefined}
                      onChange={(e) =>
                        setItems((current) => {
                          const next = { ...current };
                          if (e.target.checked) next[doc.id] = "required";
                          else delete next[doc.id];
                          return next;
                        })
                      }
                      label={
                        <>
                          {doc.label}
                          {!doc.isActive ? (
                            <span className="ml-1.5 text-xs text-dash-ink-3">
                              (kullanım dışı; istenmez)
                            </span>
                          ) : null}
                          {doc.minorsOnly ? (
                            <span className="ml-1.5 text-xs text-dash-ink-3">
                              (yalnızca 18 yaşından küçüklere)
                            </span>
                          ) : null}
                        </>
                      }
                    />
                    {requirement ? (
                      <>
                        <label htmlFor={selectId} className="sr-only">
                          {doc.label}: kural
                        </label>
                        <Select
                          id={selectId}
                          className="w-auto min-w-[9rem]"
                          value={requirement}
                          onChange={(e) => {
                            const value = DOCUMENT_REQUIREMENTS.find(
                              (r) => r === e.target.value,
                            );
                            if (value)
                              setItems((current) => ({
                                ...current,
                                [doc.id]: value,
                              }));
                          }}
                        >
                          {REQUIREMENT_ORDER.map((r) => (
                            <option key={r} value={r}>
                              {DOCUMENT_REQUIREMENT_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-dash-ink-2">
              Zorunlu: müşteri yüklemeden gönderemez. İsteğe bağlı: yüklemesi
              beklenmez. Aynı belge başka bir kuralda da varsa müşteriye en sıkı
              kural uygulanır.
            </p>
          </fieldset>
          <ResultMessage
            feedback={feedback?.tone === "error" ? feedback : null}
          />
        </div>
      </AdminModal>
    </>
  );
}

function RuleCard({
  rule,
  rules,
  documents,
}: {
  rule: DocumentRule;
  rules: DocumentRule[];
  documents: RuleDocument[];
}) {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const ordered = documents.filter((doc) =>
    rule.items.some((item) => item.documentTypeId === doc.id),
  );
  const requirementOf = new Map(
    rule.items.map((item) => [item.documentTypeId, item.requirement]),
  );
  return (
    <article className="rounded-md border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-base font-bold text-ink">{ruleTitle(rule)}</h4>
          <p className="text-sm text-muted">
            {rule.items.length === 0
              ? "Bu kuralda belge yok."
              : `${rule.items.length} belge`}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <RuleEditor rule={rule} rules={rules} documents={documents} />
          <ActionButton
            variant="ghost"
            size="sm"
            action={deleteDocumentRuleAction.bind(null, rule.id)}
            confirm={{
              title: "Kural silinsin mi?",
              description: `“${ruleTitle(rule)}” kuralı silinir. Bu kuraldaki belgeler, başka bir kuralda yoksa taslak başvurularda artık istenmez (dosya yüklenmişse dosya korunur). Gönderilmiş başvurular etkilenmez. Bu işlem hemen uygulanır.`,
              confirmLabel: "Kuralı sil",
              tone: "delete",
            }}
          >
            Sil
          </ActionButton>
        </div>
      </div>
      {ordered.length > 0 ? (
        <dl className="mt-3 grid gap-1.5 text-sm">
          {REQUIREMENT_ORDER.map((requirement) => {
            const docs = ordered.filter(
              (doc) => requirementOf.get(doc.id) === requirement,
            );
            if (docs.length === 0) return null;
            return (
              <div key={requirement} className="flex flex-wrap gap-x-2">
                <dt className="font-semibold text-ink">
                  {DOCUMENT_REQUIREMENT_LABELS[requirement]}:
                </dt>
                <dd className="text-muted">
                  {docs
                    .map((doc) =>
                      byId.get(doc.id)?.isActive
                        ? doc.label
                        : `${doc.label} (kullanım dışı)`,
                    )
                    .join(", ")}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </article>
  );
}

/** Shows the documents that will be required from the customer for the selected application types (with the saved rules). */
function RulePreview({
  rules,
  documents,
}: {
  rules: DocumentRule[];
  documents: RuleDocument[];
}) {
  const [types, setTypes] = useState<ApplicationType[]>(["student"]);
  const [sponsor, setSponsor] = useState<SponsorStatus>("employee");
  const result = requiredDocuments(
    rules,
    {
      applicationTypes: types,
      sponsorStatus: types.includes("sponsored") ? sponsor : null,
    },
    documents,
    true,
  );
  const labelOf = new Map(documents.map((doc) => [doc.id, doc]));
  return (
    <div className="rounded-md border border-line bg-white p-4">
      <h4 className="text-base font-bold text-ink">
        Önizleme: bu seçimi yapan müşteriden hangi belgeler istenir?
      </h4>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {APPLICATION_TYPES_BY_LABEL.map((type) => (
          <Checkbox
            key={type}
            id={`preview-type-${type}`}
            checked={types.includes(type)}
            onChange={(e) =>
              setTypes(
                e.target.checked
                  ? normalizeApplicationTypes([...types, type])
                  : types.filter((t) => t !== type),
              )
            }
            label={APPLICATION_TYPE_LABELS[type]}
          />
        ))}
      </div>
      {types.includes("sponsored") ? (
        <div className="mt-3 max-w-xs">
          <Field id="preview-sponsor" label="Sponsorun durumu">
            <Select
              id="preview-sponsor"
              value={sponsor}
              onChange={(e) =>
                setSponsor(
                  SPONSOR_STATUSES.find((s) => s === e.target.value) ??
                    "employee",
                )
              }
            >
              {SPONSOR_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {SPONSOR_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      {result.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Bu seçimde hiçbir belge istenmez.
        </p>
      ) : (
        <ul className="mt-3 grid gap-1.5 text-sm" aria-live="polite">
          {result.map(({ documentTypeId, requirement }) => (
            <li
              key={documentTypeId}
              className="flex flex-wrap items-center gap-2"
            >
              <Badge tone={REQUIREMENT_TONE[requirement]}>
                {DOCUMENT_REQUIREMENT_LABELS[requirement]}
              </Badge>
              <span className="text-ink">
                {labelOf.get(documentTypeId)?.label ?? documentTypeId}
              </span>
              {labelOf.get(documentTypeId)?.minorsOnly ? (
                <span className="text-xs text-muted">
                  (yalnızca başvuru sahibi 18 yaşından küçükse)
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocumentRulesManager({
  rules,
  documents,
}: {
  rules: DocumentRule[];
  documents: RuleDocument[];
}) {
  return (
    <div className="space-y-3">
      {rules.length === 0 ? (
        <p className="text-sm text-muted">
          Henüz kural yok. Kural eklenmedikçe müşteriden hiçbir belge istenmez.
        </p>
      ) : null}
      {rules.map((rule) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          rules={rules}
          documents={documents}
        />
      ))}
      <div className="pt-1">
        <RuleEditor rule={null} rules={rules} documents={documents} />
      </div>
      <div className="pt-3">
        <RulePreview rules={rules} documents={documents} />
      </div>
    </div>
  );
}
