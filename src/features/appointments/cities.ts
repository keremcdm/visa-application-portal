/**
 * Order of appointment cities: İstanbul and Ankara at the top of the list,
 * the others in Turkish alphabetical order.
 */
export const PINNED_CITY_NAMES = ["İstanbul", "Ankara"] as const;

function pinnedIndex(name: string): number {
  const key = name.trim().toLocaleLowerCase("tr-TR");
  return PINNED_CITY_NAMES.findIndex((pinned) => pinned.toLocaleLowerCase("tr-TR") === key);
}

export function compareCityNames(a: string, b: string): number {
  const pa = pinnedIndex(a);
  const pb = pinnedIndex(b);
  if (pa !== -1 || pb !== -1) return (pa === -1 ? Number.MAX_SAFE_INTEGER : pa) - (pb === -1 ? Number.MAX_SAFE_INTEGER : pb);
  return a.localeCompare(b, "tr");
}
