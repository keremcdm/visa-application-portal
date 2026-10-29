import Link from "next/link";
import { AUTH_LINK, AuthFooter, AuthShell } from "@/components/auth/auth-layout";
import type { LegalBlock, LegalDocumentContent } from "@/content/legal/types";
import { ROUTES } from "@/lib/site";

/**
 * LEGAL TEXT PAGE
 *
 * The legal counsel's texts (src/content/legal/) are shown in the look of the sign-in/sign-up pages (AuthShell; the same
 * card as legal-placeholder.tsx). The text is never changed; only the label of paragraphs starting with a short label
 * ("Kimlik ve pasaport:") is written in bold for readability.
 */

const LABEL = /^([^:]{2,48}):\s/;

function Paragraph({ text }: { text: string }) {
  const label = LABEL.exec(text);
  if (!label) return <p className="text-[15px] leading-[1.7] text-dash-ink-2 [text-wrap:pretty]">{text}</p>;
  return (
    <p className="text-[15px] leading-[1.7] text-dash-ink-2 [text-wrap:pretty]">
      <strong className="font-bold text-dash-navy">{label[1]}:</strong> {text.slice(label[0].length)}
    </p>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "h2":
      return <h2 className="mt-3 text-lg font-extrabold tracking-[-0.01em] text-dash-navy">{block.text}</h2>;
    case "h3":
      return <h3 className="mt-1 text-[15px] font-bold text-dash-navy">{block.text}</h3>;
    case "p":
      return <Paragraph text={block.text} />;
    case "table":
      return (
        <div className="overflow-x-auto rounded-[16px] border border-dash-line-soft">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px] leading-[1.55]">
            <thead className="bg-dash-subtle text-dash-navy">
              <tr>
                {block.head.map((cell) => (
                  <th key={cell} scope="col" className="px-3 py-2.5 font-bold">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]} className="border-t border-dash-line-soft align-top">
                  {row.map((cell, index) => (
                    <td key={index} className={index === 0 ? "break-words px-3 py-2.5 font-semibold text-dash-navy" : "px-3 py-2.5 text-dash-ink-2"}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function LegalDocument({ title, content, extraBlocks = [] }: { title: string; content: LegalDocumentContent; extraBlocks?: LegalBlock[] }) {
  return (
    <AuthShell>
      <article className="flex w-full max-w-[760px] flex-col gap-4 rounded-[28px] border border-dash-line-soft bg-white px-6 pb-9 pt-9 sm:px-10">
        <header className="flex flex-col gap-2">
          {content.eyebrow ? <p className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">{content.eyebrow}</p> : null}
          <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h1>
          {/* Shown if the document's own title differs from the page title (e.g. the full name of the KVKK notice). */}
          {content.title && content.title.toLocaleLowerCase("tr-TR") !== title.toLocaleLowerCase("tr-TR") ? (
            <p className="text-sm font-bold tracking-[0.02em] text-dash-navy">{content.title}</p>
          ) : null}
          {content.meta.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-[13px] text-dash-ink-3">
              {content.meta.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </header>
        {[...content.blocks, ...extraBlocks].map((block, index) => (
          <Block key={index} block={block} />
        ))}
      </article>
      <AuthFooter>
        <Link href={ROUTES.home} className={AUTH_LINK}>
          ← Giriş sayfasına dön
        </Link>
      </AuthFooter>
    </AuthShell>
  );
}
