import { FORM_SECTIONS } from "@/features/application-form/definition";
import { buildSectionDisplay, pruneFormData, type DisplayNode } from "@/features/application-form/engine";
import type { FormData, SectionId } from "@/features/application-form/types";
import type { ReactNode } from "react";

/**
 * Look: "default" admin panel; "wizard" the summary in the customer's application steps (each section a separate
 * card, question faded on the left, answer dark on the right, empty answer a faded "—"). Structure and content are the same in both.
 */
type Look = "default" | "wizard";

const STYLES: Record<
  Look,
  {
    grid: string;
    dt: string;
    dd: string;
    empty: string;
    subLabel: string;
    box: string;
    itemLabel: string;
    noItems: string;
    list: string;
    section: string;
    header: string;
    title: string;
    body: string;
  }
> = {
  default: {
    grid: "grid gap-x-6 gap-y-2.5 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]",
    dt: "text-sm text-muted",
    dd: "min-w-0 break-words text-[0.9375rem] text-ink",
    empty: "text-muted",
    subLabel: "mb-2 mt-2 text-sm font-semibold text-ink",
    box: "rounded-md border border-line p-3",
    itemLabel: "mb-2 text-sm font-medium text-muted",
    noItems: "text-sm text-muted",
    list: "space-y-4",
    section: "rounded-lg border border-line bg-white",
    header: "flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3",
    title: "font-semibold text-ink",
    body: "px-5 py-4",
  },
  wizard: {
    grid: "grid gap-x-6 gap-y-1 text-sm leading-normal sm:grid-cols-[minmax(160px,34%)_minmax(0,1fr)] sm:gap-y-3",
    dt: "text-dash-ink-3 [text-wrap:pretty] max-sm:mt-2",
    dd: "min-w-0 break-words font-semibold text-dash-navy",
    empty: "font-normal text-dash-ink-4",
    subLabel: "mb-2.5 mt-2 text-sm font-bold text-dash-navy",
    box: "rounded-[18px] bg-dash-canvas p-4",
    itemLabel: "mb-2.5 text-[13px] font-bold text-dash-ink-2",
    noItems: "text-sm text-dash-ink-4",
    list: "flex flex-col gap-4",
    section: "flex flex-col gap-4 rounded-[24px] border border-dash-line-soft bg-white px-5 py-6 sm:px-8",
    header: "flex flex-wrap items-center justify-between gap-3",
    title: "text-[17px] font-extrabold",
    body: "flex flex-col gap-4",
  },
};

function Nodes({ nodes, look }: { nodes: DisplayNode[]; look: Look }) {
  const st = STYLES[look];
  return (
    <dl className={st.grid}>
      {nodes.map((node) => {
        if (node.kind === "value") {
          return (
            <div key={node.key} className="contents">
              <dt className={st.dt}>{node.label}</dt>
              <dd className={`${st.dd} ${node.multiline ? "whitespace-pre-line" : ""}`}>
                {node.value === "" ? <span className={st.empty}>—</span> : node.value}
              </dd>
            </div>
          );
        }
        if (node.kind === "group") {
          return (
            <div key={node.key} className="sm:col-span-2">
              <p className={st.subLabel}>{node.label}</p>
              <div className={st.box}>
                <Nodes nodes={node.children} look={look} />
              </div>
            </div>
          );
        }
        return (
          <div key={node.key} className="sm:col-span-2">
            <p className={st.subLabel}>{node.label}</p>
            {node.items.length === 0 ? (
              <p className={st.noItems}>Kayıt girilmedi.</p>
            ) : (
              <div className="space-y-2">
                {node.items.map((item) => (
                  <div key={item.label} className={st.box}>
                    <p className={st.itemLabel}>{item.label}</p>
                    <Nodes nodes={item.children} look={look} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Read-only listing of the form answers (customer summary and admin panel).
 * Only visible fields are shown; old answers of hidden conditional fields are not included here either.
 */
export function FormAnswers({
  formData,
  sectionAction,
  sectionNotice,
  look = "default",
}: {
  formData: FormData;
  /** Element shown next to each section heading (e.g. a "Düzenle" link). */
  sectionAction?: (sectionId: SectionId) => ReactNode;
  /** Warning shown under the section heading (e.g. number of missing fields). */
  sectionNotice?: (sectionId: SectionId) => ReactNode;
  look?: Look;
}) {
  const pruned = pruneFormData(formData);
  const st = STYLES[look];
  return (
    <div className={st.list}>
      {FORM_SECTIONS.map((section) => (
        <section key={section.id} aria-labelledby={`answer-${section.id}`} className={st.section}>
          <div className={st.header}>
            <h3 id={`answer-${section.id}`} className={st.title}>
              {section.title}
            </h3>
            {sectionAction?.(section.id)}
          </div>
          <div className={st.body}>
            {sectionNotice?.(section.id)}
            <Nodes nodes={buildSectionDisplay(section, pruned)} look={look} />
          </div>
        </section>
      ))}
    </div>
  );
}
