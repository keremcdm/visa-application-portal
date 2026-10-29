import Link from "next/link";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth/auth-layout";
import { ROUTES } from "@/lib/site";
import { ERROR_PRIMARY, ErrorCard } from "./error-card";

type AccessNoticeProps = {
  title: string;
  children: ReactNode;
  homeHref?: string;
  /** Code inside the circle (default "404"). */
  code?: ReactNode;
  /** Red for a general (temporary) error. */
  tone?: "navy" | "red";
};

/** Body of the not-found and access error screens (look: src/components/layout/error-card.tsx). */
export function AccessNotice({ title, children, homeHref = ROUTES.customer, code = "404", tone = "navy" }: AccessNoticeProps) {
  return (
    <div className="py-10">
      <ErrorCard
        code={code}
        tone={tone}
        title={title}
        actions={
          <Link href={homeHref} className={ERROR_PRIMARY}>
            Panele dön
          </Link>
        }
      >
        <p>{children}</p>
      </ErrorCard>
    </div>
  );
}

/** Error screens opened outside the panel frame: the same frame as the sign-in pages (logo in the middle, footer). */
export function PublicNoticePage(props: AccessNoticeProps) {
  return (
    <AuthShell>
      <AccessNotice {...props} />
    </AuthShell>
  );
}
