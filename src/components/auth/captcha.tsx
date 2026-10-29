"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { CAPTCHA_FIELD } from "@/features/auth/captcha";

/*
 * Cloudflare Turnstile verification box. Shown "only when needed":
 * most users see nothing; if Cloudflare is suspicious a "verify you are human" box appears.
 * Nothing is rendered if no site key is set. The token is single-use; every time `resetKey` changes (every time the
 * form is submitted) a new one is requested and the old one is never sent.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileOptions = {
  sitekey: string;
  language: string;
  theme: "light" | "dark" | "auto";
  appearance: "always" | "execute" | "interaction-only";
  size: "normal" | "flexible" | "compact";
  "response-field": boolean;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

let loader: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loader = null;
      script.remove();
      reject(new Error("turnstile_load_failed"));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export const captchaEnabled = SITE_KEY !== "";

export type CaptchaHandle = { token: () => string };

export function Captcha({ resetKey, ref }: { resetKey?: unknown; ref?: Ref<CaptchaHandle> }) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const currentKey = useRef(resetKey);
  const [entry, setEntry] = useState<{ key: unknown; token: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    currentKey.current = resetKey;
  });

  useEffect(() => {
    if (!captchaEnabled) return;
    let cancelled = false;
    loadTurnstile().then(
      () => {
        if (cancelled || !container.current || !window.turnstile) return;
        widget.current = window.turnstile.render(container.current, {
          sitekey: SITE_KEY,
          language: "tr",
          theme: "light",
          appearance: "interaction-only",
          size: "flexible",
          "response-field": false,
          callback: (token) => setEntry({ key: currentKey.current, token }),
          "expired-callback": () => setEntry(null),
          "error-callback": () => setEntry(null),
        });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, []);

  // Form submitted: drop the used token and request a new one.
  const previousKey = useRef(resetKey);
  useEffect(() => {
    if (previousKey.current === resetKey) return;
    previousKey.current = resetKey;
    if (widget.current) window.turnstile?.reset(widget.current);
  }, [resetKey]);

  const token = entry && entry.key === resetKey ? entry.token : "";
  useImperativeHandle(ref, () => ({ token: () => token }), [token]);

  if (!captchaEnabled) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div ref={container} />
      <input type="hidden" name={CAPTCHA_FIELD} value={token} />
      {failed ? (
        <p role="alert" className="text-[13px] font-semibold text-dash-red">
          Güvenlik doğrulaması yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyiniz.
        </p>
      ) : null}
    </div>
  );
}
