"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { markMessageReadAction } from "@/server/actions/applications";

export type StatusMessage = { id: string; body: string; dateText: string; unread: boolean };

/**
 * "Danışmanınızdan mesajlar" (messages from your consultant). Unread messages have a reddish background and show as
 * "n yeni" (n new) in the card heading; a message is marked read when the customer clicks it.
 * If marking fails on the server the message stays unread and this is stated clearly.
 */
export function MessagesCard({ applicationId, messages }: { applicationId: string; messages: readonly StatusMessage[] }) {
  const [read, setRead] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const isUnread = (m: StatusMessage) => m.unread && !read.has(m.id);
  const unreadCount = messages.filter(isUnread).length;

  const markRead = (id: string) => {
    setFailed(false);
    setRead((current) => new Set(current).add(id));
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await markMessageReadAction(applicationId, id)).ok;
      } catch {
        ok = false;
      }
      if (!ok) {
        setRead((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setFailed(true);
      }
    });
  };

  return (
    <section
      id="messages"
      aria-labelledby="messages-heading"
      className={cn(
        "flex scroll-mt-6 flex-col gap-4 rounded-[24px] border-[1.5px] bg-white px-5 py-6 sm:px-7",
        unreadCount > 0 ? "border-dash-red-border" : "border-dash-line-soft",
      )}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="relative flex size-10 flex-none items-center justify-center rounded-full bg-dash-navy text-white">
          <MessageCircle className="size-[18px]" strokeWidth={2.5} />
          {unreadCount > 0 ? <span className="absolute -right-0.5 -top-0.5 size-[13px] rounded-full border-2 border-white bg-dash-red" /> : null}
        </span>
        <h2 id="messages-heading" className="flex-1 text-[17px] font-extrabold">
          Danışmanınızdan mesajlar
        </h2>
        {unreadCount > 0 ? (
          <span className="flex h-[26px] items-center whitespace-nowrap rounded-full bg-dash-red px-[11px] text-xs font-extrabold text-white">{unreadCount} yeni</span>
        ) : null}
      </div>
      {messages.length === 0 ? (
        <p className="rounded-[18px] bg-dash-canvas px-4 py-5 text-center text-sm text-dash-ink-3">Henüz bir mesaj yok.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {messages.map((message) => {
            const unread = isUnread(message);
            const content = (
              <>
                <span className={cn("text-xs font-bold", unread ? "text-dash-red" : "text-dash-ink-4")}>
                  {unread ? <span className="sr-only">Yeni mesaj, </span> : null}
                  {message.dateText}
                </span>
                <span className="whitespace-pre-line text-left text-sm leading-[1.6] text-dash-ink">{message.body}</span>
              </>
            );
            return (
              <li key={message.id}>
                {unread ? (
                  <button
                    type="button"
                    onClick={() => markRead(message.id)}
                    className="flex w-full flex-col items-start gap-1.5 rounded-[18px] bg-dash-red-tint px-[18px] py-4 transition-colors motion-reduce:transition-none hover:bg-dash-red-tint-hover"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex flex-col items-start gap-1.5 rounded-[18px] bg-dash-canvas px-[18px] py-4">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {failed ? (
        <p role="alert" className="text-[13px] font-semibold text-dash-red">
          Mesaj okundu olarak işaretlenemedi. Lütfen sayfayı yenileyip tekrar deneyiniz.
        </p>
      ) : null}
    </section>
  );
}
