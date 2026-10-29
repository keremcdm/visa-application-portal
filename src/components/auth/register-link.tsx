"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/site";

/**
 * Session storage key used to carry the e-mail from the sign-in screen to the sign-up form. The e-mail is never written
 * to the address (URL); it stays briefly in this tab's storage only and is deleted once the sign-up form reads it.
 */
export const REGISTER_EMAIL_KEY = "vbp:signup-email";

/** "Hesap oluşturun" (create account) link: carries the e-mail typed into the sign-in form over to the sign-up form. */
export function RegisterLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Link
      href={ROUTES.register}
      className={className}
      onClick={() => {
        const input = document.getElementById("email");
        const email = input instanceof HTMLInputElement ? input.value.trim() : "";
        try {
          if (email && email.length <= 254 && email.includes("@")) sessionStorage.setItem(REGISTER_EMAIL_KEY, email);
          else sessionStorage.removeItem(REGISTER_EMAIL_KEY);
        } catch {
          // If storage is unavailable (private window etc.) the e-mail is not carried over; the sign-up form opens empty.
        }
      }}
    >
      {children}
    </Link>
  );
}
