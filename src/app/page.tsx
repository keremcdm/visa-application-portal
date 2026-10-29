import Image from "next/image";
import Link from "next/link";
import { cn } from "@/components/ui/primitives";
import { figtree } from "@/lib/fonts/figtree";
import { LEGAL_FOOTER_LINKS, ROUTES, SITE } from "@/lib/site";

/**
 * THE PORTAL'S ENTRY SCREEN
 *
 * The single card shown when the site opens: logo, red line, heading, "Giriş Yap" / "Kayıt Ol" (sign in / sign up) and
 * "Şifremi Unuttum" (forgot password); legal links at the bottom. Sizes and colors are from the design (dash-* tokens in
 * globals.css, Figtree). The text logo in the design is a placeholder; the site's real logo (SITE.logo) is used instead at
 * about 210 px wide. No promotional content is added to this screen; the options lead to the authentication pages.
 */
const LOGO_WIDTH = 210;
const ACTION = "flex h-[52px] items-center justify-center rounded-full text-[15px] font-bold no-underline transition-colors motion-reduce:transition-none";

export default function HomePage() {
  const logoHeight = Math.round((LOGO_WIDTH * SITE.logo.height) / SITE.logo.width);

  return (
    <div className={cn(figtree.variable, "dash-root flex min-h-dvh flex-1 flex-col bg-dash-canvas font-dash text-dash-navy")}>
      <main id="content" className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="flex w-full max-w-[440px] flex-col items-center gap-9 rounded-[28px] border border-dash-line bg-white px-6 pb-10 pt-[52px] sm:px-11">
          <div className="flex flex-col items-center gap-5">
            <Image src={SITE.logo.src} alt={SITE.logo.alt} width={LOGO_WIDTH} height={logoHeight} priority className="block h-auto w-[210px]" />
            <span aria-hidden className="h-[3px] w-8 rounded-sm bg-dash-red" />
            <h1 className="text-balance text-center text-[22px] font-extrabold tracking-[-0.02em]">Online Vize Başvuru Portalı</h1>
          </div>
          <div className="flex w-full flex-col gap-3">
            <Link href={ROUTES.login} className={cn(ACTION, "bg-dash-navy text-white hover:bg-dash-navy-hover hover:text-white")}>
              Giriş Yap
            </Link>
            <Link href={ROUTES.register} className={cn(ACTION, "border-[1.5px] border-dash-line-strong bg-white text-dash-navy hover:bg-dash-subtle hover:text-dash-navy")}>
              Kayıt Ol
            </Link>
          </div>
          <Link href={ROUTES.forgotPassword} className="text-sm font-semibold text-dash-red no-underline transition-colors hover:text-dash-red-hover motion-reduce:transition-none">
            Şifremi Unuttum
          </Link>
        </div>
      </main>
      <footer className="flex flex-col items-center gap-2.5 px-5 pb-7 pt-6">
        <nav aria-label="Yasal bilgiler" className="flex flex-wrap justify-center gap-x-7 gap-y-2 text-[13px] font-medium">
          {LEGAL_FOOTER_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-dash-ink-2 no-underline transition-colors hover:text-dash-navy motion-reduce:transition-none">
              {link.title}
            </Link>
          ))}
        </nav>
        <span className="text-xs text-dash-ink-4">{SITE.copyrightNotice}</span>
      </footer>
    </div>
  );
}
