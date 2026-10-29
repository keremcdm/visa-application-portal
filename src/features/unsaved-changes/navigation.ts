/**
 * Whether a link clicked while there are unsaved changes should be stopped with a warning.
 *
 * Only clicks within the site that go to another page in the same tab are stopped and a warning dialog is shown.
 * Links that open in a new tab, download, or stay on the same page (only the # changes) are not stopped because they do
 * not lose changes. Links to another site close the page completely, so the browser's own warning (beforeunload)
 * is shown.
 */
export type LinkClick = {
  href: string | null;
  target: string | null;
  download: boolean;
  button: number;
  /** Is Ctrl, Cmd, Shift or Alt held down. */
  modifier: boolean;
  defaultPrevented: boolean;
};

/** The address to go to if the click is stopped (path + query + #); null if it is not stopped. */
export function guardedDestination(click: LinkClick, current: URL): string | null {
  if (click.defaultPrevented || click.button !== 0 || click.modifier || click.download) return null;
  if (click.target && click.target !== "_self") return null;
  if (!click.href) return null;

  let url: URL;
  try {
    url = new URL(click.href, current);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
