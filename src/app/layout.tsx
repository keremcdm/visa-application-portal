import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SITE } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    // If the organization name equals the product name it is not written twice.
    default: SITE.productName === SITE.companyName ? SITE.productName : `${SITE.productName} | ${SITE.companyName}`,
    template: `%s | ${SITE.companyName}`,
  },
  description: "Vize başvurunuz için gerekli bilgileri ve belgeleri güvenli biçimde iletebileceğiniz başvuru portalı.",
  // The portal is a private application for customers; it is not indexed by search engines.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/brand/icon.svg", type: "image/svg+xml" },
      { url: "/brand/icon.png", type: "image/png", sizes: "64x64" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#19214f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-800"
        >
          İçeriğe geç
        </a>
        {children}
      </body>
    </html>
  );
}
