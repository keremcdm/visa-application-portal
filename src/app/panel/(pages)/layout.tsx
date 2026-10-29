/**
 * Risk Assessment Test page of the customer panel. The top bar and footer are in
 * src/app/panel/layout.tsx. Application pages (src/app/panel/applications/), My Account (src/app/panel/account/)
 * and notifications (src/app/panel/notifications/) use their own frames.
 */
export default function CustomerPagesLayout({ children }: LayoutProps<"/panel">) {
  return (
    <main id="content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      {children}
    </main>
  );
}
