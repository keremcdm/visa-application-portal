"use client";

import { useState, type ReactNode } from "react";
import { Check, ListChecks, Lock } from "lucide-react";
import { useServerAction } from "@/components/ui/action-button";
import { cn } from "@/components/ui/primitives";
import type { SectionMode } from "@/features/staff/admin-state";
import { createTaskAction, setTaskStatusAction } from "@/server/actions/staff";
import { AdminModal, ModalClose, ResultMessage } from "./admin-modal";
import { adminButton } from "./ui";

/*
 * APPLICATION DETAIL — SECTIONS
 * Depending on its state each section is drawn either as a row (completed / locked / current) or as an open card. Completed
 * Payment and Review rows and the task row open with "Ayrıntı" / "Görev ekle / gör" and close with "Daralt".
 */

const ghost = adminButton("ghost", "xs", "h-8 px-3");

function RowIcon({ mode, icon }: { mode: SectionMode; icon?: "tasks" }) {
  if (icon === "tasks") return <ListChecks aria-hidden className="size-5 flex-none text-dash-ink-2" strokeWidth={2.5} />;
  if (mode === "done")
    return (
      <span className="grid size-[22px] flex-none place-items-center rounded-full bg-dash-green">
        <Check aria-hidden className="size-3 text-white" strokeWidth={3.5} />
        <span className="sr-only">Tamamlandı</span>
      </span>
    );
  if (mode === "current")
    return (
      <span className="size-[22px] flex-none rounded-full border-4 border-dash-red">
        <span className="sr-only">Şu anki aşama</span>
      </span>
    );
  return (
    <span className="flex-none">
      <Lock aria-hidden className="size-5 text-dash-ink-4" strokeWidth={2.5} />
      <span className="sr-only">Kilitli</span>
    </span>
  );
}

export function DetailSection({
  id,
  title,
  mode,
  summary,
  canExpand = false,
  expandLabel = "Ayrıntı",
  icon,
  header,
  description,
  children,
}: {
  id: string;
  title: string;
  mode: SectionMode;
  summary: string;
  canExpand?: boolean;
  expandLabel?: string;
  icon?: "tasks";
  /** Label next to the heading in an open card. */
  header?: ReactNode;
  /** Description under the heading in an open card. */
  description?: ReactNode;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const full = mode === "open" || (canExpand && expanded);

  if (!full) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[18px] border border-dash-line bg-white py-3 pl-[18px] pr-4">
        <RowIcon mode={mode} icon={icon} />
        <h2 className="w-[170px] flex-none text-[15px] font-extrabold">{title}</h2>
        <span className="mr-auto min-w-0 flex-1 basis-[200px] text-sm text-dash-ink-2">{summary}</span>
        {canExpand ? (
          <button type="button" className={ghost} aria-expanded={false} aria-controls={id} onClick={() => setExpanded(true)}>
            {expandLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-4 rounded-[22px] border border-dash-line bg-white px-6 py-[22px]">
      <div className="flex items-start gap-2.5">
        <div className="mr-auto flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id={`${id}-title`} className="text-lg font-extrabold tracking-[-0.02em]">
              {title}
            </h2>
            {header}
          </div>
          {description ? <p className="text-[13px] text-dash-ink-2">{description}</p> : null}
        </div>
        {canExpand && expanded && mode !== "open" ? (
          <button type="button" className={ghost} aria-expanded onClick={() => setExpanded(false)}>
            Daralt
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// --- Customer tasks ------------------------------------------------------------------------------------------------

export type TaskItem = { id: string; title: string; meta: string; status: "open" | "completed" | "cancelled" };

function TaskButtons({ applicationId, task }: { applicationId: string; task: TaskItem }) {
  const { pending, feedback, run } = useServerAction();
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {task.status === "open" ? (
        <>
          <button
            type="button"
            className={adminButton("secondary", "sm", "px-3")}
            disabled={pending}
            onClick={() => run(() => setTaskStatusAction(applicationId, task.id, "completed"))}
          >
            Tamamlandı
          </button>
          <button
            type="button"
            className={adminButton("ghostDanger", "sm", "px-3")}
            disabled={pending}
            onClick={() => run(() => setTaskStatusAction(applicationId, task.id, "cancelled"))}
          >
            İptal et
          </button>
        </>
      ) : (
        <button type="button" className={adminButton("ghost", "sm", "px-3")} disabled={pending} onClick={() => run(() => setTaskStatusAction(applicationId, task.id, "open"))}>
          Yeniden aç
        </button>
      )}
      {feedback?.tone === "error" ? <ResultMessage feedback={feedback} className="basis-full" /> : null}
    </span>
  );
}

export function TaskPanel({ applicationId, tasks }: { applicationId: string; tasks: TaskItem[] }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showDone, setShowDone] = useState(false);
  const { pending, feedback, run } = useServerAction();
  const open = tasks.filter((t) => t.status === "open");
  const closed = tasks.filter((t) => t.status !== "open");
  const field = "h-[42px] min-w-0 rounded-full border-[1.5px] border-dash-line-strong bg-white px-4 text-sm text-dash-navy placeholder:text-dash-ink-4";

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="sr-only" htmlFor="task-title">
          Görev başlığı
        </label>
        <input id="task-title" className={field} placeholder="Başlık" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="sr-only" htmlFor="task-description">
          Görev açıklaması
        </label>
        <input
          id="task-description"
          className={field}
          placeholder="Açıklama (isteğe bağlı)"
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          type="button"
          className={adminButton("primary", "md", "h-[42px] px-[18px]")}
          disabled={pending || title.trim() === ""}
          onClick={() =>
            run(
              () => createTaskAction(applicationId, title, description),
              () => {
                setTitle("");
                setDescription("");
              },
            )
          }
        >
          {pending ? "Kaydediliyor…" : "Görev oluştur"}
        </button>
      </div>
      <span className="-mt-1.5 text-xs text-dash-ink-3">Yeni görev müşteriye bildirim olarak gider.</span>
      <ResultMessage feedback={feedback} />
      <div className="flex flex-col">
        {open.length === 0 ? <p className="border-t border-dash-line-soft py-2.5 text-sm text-dash-ink-3">Açık görev yok.</p> : null}
        {open.map((task) => (
          <div key={task.id} className="flex flex-wrap items-center gap-2.5 border-t border-dash-line-soft py-3">
            <div className="mr-auto flex min-w-0 flex-col">
              <span className="text-sm font-bold">{task.title}</span>
              <span className="text-xs text-dash-ink-3">{task.meta}</span>
            </div>
            <span className="rounded-full bg-dash-draft-bg px-2.5 py-1 text-xs font-bold text-dash-draft-ink">Müşteride</span>
            <TaskButtons applicationId={applicationId} task={task} />
          </div>
        ))}
        {closed.length > 0 ? (
          <button
            type="button"
            className={adminButton("ghost", "sm", "-ml-3 self-start px-3 text-dash-ink-2 hover:text-dash-ink-2")}
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? "Tamamlananları gizle" : `Tamamlanan ${closed.length} görevi göster`}
          </button>
        ) : null}
        {showDone
          ? closed.map((task) => (
              <div key={task.id} className="flex flex-wrap items-center gap-3 border-t border-dash-line-soft py-2.5">
                <Check aria-hidden className={cn("size-4 flex-none", task.status === "completed" ? "text-dash-green" : "text-dash-ink-4")} strokeWidth={3.5} />
                <div className="mr-auto flex min-w-0 flex-col">
                  <span className="text-sm text-dash-ink-2">{task.title}</span>
                  <span className="text-xs text-dash-ink-4">
                    {task.status === "cancelled" ? "İptal edildi · " : ""}
                    {task.meta}
                  </span>
                </div>
                <TaskButtons applicationId={applicationId} task={task} />
              </div>
            ))
          : null}
      </div>
    </>
  );
}

// --- Risk Assessment Test answers ----------------------------------------------------------------------------------

export function RiskAnswersButton({ answers, flags, dateText }: { answers: { question: string; answer: string }[]; flags: string[]; dateText: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={adminButton("ghost", "xs", "-ml-3 self-start px-3")} onClick={() => setOpen(true)}>
        Cevapları göster
      </button>
      <AdminModal
        open={open}
        onOpenChange={setOpen}
        title="Risk Analiz Testi cevapları"
        description={`Test tarihi: ${dateText}. Sonuç müşterinin kendi cevaplarından hesaplanır; müşteri testi yeniden yaparsa güncellenir.`}
        footer={<ModalClose className={adminButton("secondary", "md", "h-[42px] px-[18px]")}>Kapat</ModalClose>}
      >
        <ol className="flex flex-col gap-2.5 text-sm">
          {answers.map((item, index) => (
            <li key={item.question}>
              <span className="text-dash-ink-3">
                {index + 1}. {item.question}
              </span>
              <span className="block font-bold">{item.answer}</span>
            </li>
          ))}
        </ol>
        {flags.length > 0 ? (
          <div className="rounded-[14px] bg-dash-draft-bg px-3.5 py-3 text-sm text-dash-draft-ink">
            <p className="font-bold">Dikkat edilmesi gereken noktalar</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              {flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </AdminModal>
    </>
  );
}
