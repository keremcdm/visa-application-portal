import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** Supabase origin; added to connect-src for signed uploads (PUT) from the browser. */
function supabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** CAPTCHA (Cloudflare Turnstile; src/features/auth/captcha.ts): the script and its frame are allowed when a site key is set. */
const TURNSTILE_ORIGIN = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ? "https://challenges.cloudflare.com" : null;

function contentSecurityPolicy(): string {
  const supabase = supabaseOrigin();
  const connect = ["'self'", supabase, isDev ? "ws:" : null].filter(Boolean).join(" ");
  // Note: 'unsafe-inline' is required because of Next.js's inline bootstrap scripts.
  const script = ["'self'", "'unsafe-inline'", isDev ? "'unsafe-eval'" : null, TURNSTILE_ORIGIN].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src ${script}`,
    TURNSTILE_ORIGIN ? `frame-src ${TURNSTILE_ORIGIN}` : null,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    isDev ? null : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // By default the dev server logs every server action WITH ITS ARGUMENTS to the terminal;
  // turned off so form answers (personal data) never end up in logs. Request lines are still logged.
  logging: { serverFunctions: false },
  // The PDF template and fonts are read from the file system at runtime.
  outputFileTracingIncludes: {
    "/api/**/*": ["./assets/**/*"],
  },
  serverExternalPackages: ["pdf-lib", "@pdf-lib/fontkit"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
