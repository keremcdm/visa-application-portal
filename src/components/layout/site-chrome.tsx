import Image from "next/image";
import Link from "next/link";
import { LEGAL_FOOTER_LINKS, ROUTES, SITE } from "@/lib/site";
import { telHref } from "@/lib/validation/formats";

export function Logo({ href = ROUTES.home, height = 40 }: { href?: string; height?: number }) {
  const width = Math.round((SITE.logo.width / SITE.logo.height) * height);
  return (
    <Link href={href} className="inline-flex shrink-0 items-center" aria-label={`${SITE.companyName} — ana sayfa`}>
      <Image src={SITE.logo.src} alt={SITE.logo.alt} width={width} height={height} priority />
    </Link>
  );
}

type FooterLink = { href: string; title: string };

const PANEL_FOOTER_LINKS: readonly FooterLink[] = LEGAL_FOOTER_LINKS;

/** The default content is the panels' footer; the sign-in/sign-up/password pages provide their own content. */
export function SiteFooter({
  notice = SITE.companyName,
  links = PANEL_FOOTER_LINKS,
  contact,
}: {
  notice?: string;
  links?: readonly FooterLink[];
  /** Company contact details from Settings (in the customer panel; hidden if not entered). */
  contact?: { email: string | null; phone: string | null };
}) {
  const tel = telHref(contact?.phone ?? null);
  return (
    // Centered on phones; justified to both sides on wide screens.
    <footer className="no-print mt-auto border-t border-line bg-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-4 py-6 text-center text-sm text-muted sm:flex-row sm:justify-between sm:px-6 sm:text-left">
        <div className="flex flex-col gap-1">
          <p>{notice}</p>
          {contact && (contact.email || contact.phone) ? (
            <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 sm:justify-start">
              <span>İletişim:</span>
              {contact.phone ? (
                tel ? (
                  <a href={tel} className="underline-offset-4 hover:text-ink hover:underline">
                    {contact.phone}
                  </a>
                ) : (
                  <span>{contact.phone}</span>
                )
              ) : null}
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="underline-offset-4 hover:text-ink hover:underline">
                  {contact.email}
                </a>
              ) : null}
            </p>
          ) : null}
        </div>
        {/* The three links do not fit on one line on phones, so they are stacked and centered (the "·" was left dangling at line ends). */}
        <nav aria-label="Yasal bilgiler" className="flex flex-col items-center gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="underline-offset-4 hover:text-ink hover:underline">
              {link.title}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
