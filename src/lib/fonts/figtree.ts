import { Figtree } from "next/font/google";

/**
 * The customer panel's font. The variable is only defined on the element that uses it:
 * the panel frame (src/app/panel/layout.tsx) and dialogs opened outside the page (e.g. the visa outcome dialog).
 */
export const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700", "800"], display: "swap" });
