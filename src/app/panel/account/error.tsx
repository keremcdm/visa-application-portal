"use client";

import { RouteError } from "@/components/layout/route-error";

export default function AccountError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <RouteError {...props} />
    </main>
  );
}
