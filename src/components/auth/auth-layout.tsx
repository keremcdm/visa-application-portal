import Link from "next/link";
import type { ReactNode } from "react";
import { AlertCircle, Mail } from "lucide-react";
import { wizButtonClass } from "@/components/customer/wizard/ui";
import { Logo, SiteFooter } from "@/components/layout/site-chrome";
import { cn } from "@/components/ui/primitives";
import { figtree } from "@/lib/fonts/figtree";
import { LEGAL_FOOTER_LINKS, ROUTES, SITE } from "@/lib/site";

/*
 * SIGN-IN, SIGN-UP AND PASSWORD PAGES
 * Logo in the middle, a single white card below (wider for sign-up), and a redirect line under the card. Texts, fields
 * and the authentication flow are the same as on the previous pages; only the look changes. The footer with legal links stays.
 */

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className={cn(figtree.variable, "wiz-root dash-root flex flex-1 flex-col bg-dash-canvas font-dash text-dash-ink")}>
      <main id="content" className="flex flex-1 flex-col items-center gap-7 px-5 pb-16 pt-12">
        <Logo height={56} />
        {children}
      </main>
      <SiteFooter notice={SITE.copyrightNotice} links={LEGAL_FOOTER_LINKS} />
    </div>
  );
}

export function AuthCard({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <section className={cn("flex w-full flex-col gap-6 rounded-[28px] border border-dash-line-soft bg-white px-6 pb-8 pt-9 sm:px-9", wide ? "max-w-[520px]" : "max-w-[440px]")}>
      {children}
    </section>
  );
}

export function AuthHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h1>
      {description ? <p className="text-sm leading-[1.6] text-dash-ink-2 [text-wrap:pretty]">{description}</p> : null}
    </div>
  );
}

/** Redirect line under the card ("Hesabınız yok mu? Hesap oluşturun"). */
export function AuthFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-center gap-2 text-center text-sm text-dash-ink-2">{children}</div>;
}

/** Look of the link in the redirect line. */
export const AUTH_LINK = "font-extrabold text-dash-red hover:text-dash-red-hover";

/** Error box: red tint background, warning icon. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[14px] bg-dash-red-tint px-3.5 py-3">
      <AlertCircle aria-hidden className="mt-0.5 size-4 flex-none text-dash-red" strokeWidth={2.75} />
      <p className="text-[13px] font-semibold leading-normal text-dash-red-hover">{children}</p>
    </div>
  );
}

/** Success state: in the same card, a centered e-mail icon, title, the app's own message and "Giriş sayfasına dön" (back to sign-in). */
export function AuthDone({ title, message, extra }: { title: string; message: string; extra?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center gap-[18px] py-2 text-center">
      <span aria-hidden className="flex size-[76px] items-center justify-center rounded-full bg-dash-navy-tint text-dash-navy">
        <Mail className="size-7" strokeWidth={2.5} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">{title}</h1>
        <p className="text-sm leading-[1.6] text-dash-ink-2 [text-wrap:pretty]">{message}</p>
      </div>
      <Link href={ROUTES.login} className={wizButtonClass("primary", "xl", "w-full")}>
        Giriş sayfasına dön
      </Link>
      {extra}
    </div>
  );
}
