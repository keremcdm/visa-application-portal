"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical } from "lucide-react";
import { useState } from "react";
import { useServerAction } from "@/components/ui/action-button";
import { Button, cn } from "@/components/ui/primitives";
import { AdminModal, ModalClose, ResultMessage } from "./admin/admin-modal";
import { adminButton } from "./admin/ui";
import { moveItem } from "@/features/staff/ordering";
import {
  reorderSettingsAction,
  type SortableList,
} from "@/server/actions/settings";

/*
 * REORDER
 * Settings lists are reordered by dragging inside a dialog. Dragging is for the mouse; for keyboard and touch screens every
 * row has up/down buttons. The order is saved with "Sırayı kaydet" (save order); it is independent of the list's other
 * changes (the "Kaydet" bar at the bottom).
 */

export type ReorderItem = { id: string; label: string; note?: string };

export function ReorderButton({
  list,
  items,
  title,
  description,
}: {
  list: SortableList;
  items: ReorderItem[];
  title: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(items);
  const [dragging, setDragging] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const { pending, feedback, run, setFeedback } = useServerAction();

  const openChange = (next: boolean) => {
    // Every time it opens it starts from the current list; an unsaved order is discarded.
    if (next) {
      setOrder(items);
      setFeedback(null);
      setAnnouncement("");
    }
    setOpen(next);
  };

  const move = (from: number, to: number, announce: boolean) => {
    if (to < 0 || to >= order.length || from === to) return;
    const item = order[from]!;
    setOrder(moveItem(order, from, to));
    if (announce) setAnnouncement(`“${item.label}” ${to + 1}. sıraya taşındı.`);
  };

  const changed = order.some((item, index) => item.id !== items[index]?.id);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={items.length < 2}
        onClick={() => openChange(true)}
      >
        <ArrowUpDown aria-hidden className="size-4" />
        Sırayı değiştir
      </Button>
      <AdminModal
        open={open}
        onOpenChange={openChange}
        title={title}
        description={description}
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
              disabled={pending || !changed}
              onClick={() =>
                run(
                  () =>
                    reorderSettingsAction(
                      list,
                      order.map((item) => item.id),
                    ),
                  () => setOpen(false),
                )
              }
            >
              {pending ? "Kaydediliyor…" : "Sırayı kaydet"}
            </button>
          </>
        }
      >
        <ol className="flex flex-col gap-1.5" aria-label="Sıralanacak liste">
          {order.map((item, index) => (
            <li
              key={item.id}
              draggable
              onDragStart={(e) => {
                setDragging(index);
                e.dataTransfer.effectAllowed = "move";
                // Firefox does not start a drag without data.
                e.dataTransfer.setData("text/plain", item.id);
              }}
              onDragOver={(e) => {
                if (dragging === null) return;
                e.preventDefault();
                if (dragging !== index) {
                  move(dragging, index, false);
                  setDragging(index);
                }
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={() => {
                if (dragging !== null)
                  setAnnouncement(
                    `“${order[dragging]?.label ?? ""}” ${dragging + 1}. sırada.`,
                  );
                setDragging(null);
              }}
              className={cn(
                "flex cursor-grab items-center gap-2 rounded-md border bg-white py-1.5 pl-2 pr-1.5 active:cursor-grabbing",
                dragging === index
                  ? "border-dash-navy opacity-60"
                  : "border-dash-line-strong",
              )}
            >
              <GripVertical
                aria-hidden
                className="size-4 shrink-0 text-dash-ink-3"
              />
              <span className="w-6 shrink-0 text-right text-xs font-bold tabular-nums text-dash-ink-3">
                {index + 1}.
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-dash-navy">
                {item.label}
                {item.note ? (
                  <span className="ml-2 text-xs font-medium text-dash-ink-3">
                    {item.note}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-dash-ink-2 hover:bg-dash-subtle hover:text-dash-navy disabled:opacity-30"
                aria-label={`“${item.label}” yukarı taşı`}
                disabled={index === 0}
                onClick={() => move(index, index - 1, true)}
              >
                <ArrowUp aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-dash-ink-2 hover:bg-dash-subtle hover:text-dash-navy disabled:opacity-30"
                aria-label={`“${item.label}” aşağı taşı`}
                disabled={index === order.length - 1}
                onClick={() => move(index, index + 1, true)}
              >
                <ArrowDown aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ol>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <ResultMessage
          feedback={feedback?.tone === "error" ? feedback : null}
        />
      </AdminModal>
    </>
  );
}
