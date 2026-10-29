/**
 * Validation of the Turkish national ID number (and the foreigner ID number, which uses the same algorithm).
 * The value is always handled as TEXT; never converted to a number.
 */
export function isValidNationalId(value: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(value)) return false;
  const d = Array.from(value, (c) => c.charCodeAt(0) - 48);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  if (tenth !== d[9]) return false;
  const eleventh = (odd + even + d[9]!) % 10;
  return eleventh === d[10];
}

/** Strips spaces and separators from the user's input; keeps non-digit characters so validation rejects them. */
export function normalizeNationalId(value: string): string {
  return value.replace(/[\s-]/g, "");
}
