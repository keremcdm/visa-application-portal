/**
 * ORDER OF SETTINGS LISTS
 *
 * Cities, appointment locations, documents and ZIP folders are reordered in Settings by dragging (or with the up/down
 * buttons); the order is written to the sort_order column starting at 1. In a list that was never ordered everyone has the
 * same sort_order (0) and the list's old rule applies (for cities İstanbul and Ankara first, the rest alphabetical).
 */

/** Moves an item in the list from position `from` to `to`; the list is not mutated, a new one is returned. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** sort_order first, then the list's own rule on ties. */
export function bySortOrder<T extends { sortOrder: number }>(fallback: (a: T, b: T) => number): (a: T, b: T) => number {
  return (a, b) => a.sortOrder - b.sortOrder || fallback(a, b);
}

/** Rows whose sort_order changes with the new order (to avoid needless writes and audit entries). */
export function changedSortOrders(ids: readonly string[], current: ReadonlyMap<string, number>): { id: string; sortOrder: number }[] {
  return ids.map((id, index) => ({ id, sortOrder: index + 1 })).filter(({ id, sortOrder }) => current.get(id) !== sortOrder);
}

/** Does the submitted order contain every row of the list exactly once (no rows added/deleted in the meantime)? */
export function isCompleteOrder(ids: readonly string[], existing: Iterable<string>): boolean {
  const all = new Set(existing);
  return ids.length === all.size && new Set(ids).size === ids.length && ids.every((id) => all.has(id));
}

/** Order of a newly added row: at the end if the list was ordered by hand; 0 if never ordered (the list's old rule). */
export function nextSortOrder(existing: readonly number[]): number {
  const max = existing.reduce((a, b) => Math.max(a, b), 0);
  return max > 0 ? max + 1 : 0;
}
