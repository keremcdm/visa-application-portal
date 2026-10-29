import { createHash, randomInt } from "node:crypto";

/**
 * TWO-FACTOR AUTHENTICATION RECOVERY CODE
 *
 * A staff member who lost access to their authenticator app signs in with their password, then uses this code to remove
 * the authenticator and set up two-factor authentication again. The code has 20 characters (5 groups of 4, e.g.
 * "K7Q4-9MZD-X2PH-RT6W-8BNC"); 0/O and 1/I/L are not used to avoid confusion. 20 characters from a 31-character alphabet
 * ≈ 99 bits of randomness: not guessable. Only the SHA-256 digest is stored in the database (migration 23).
 */

export const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_LENGTH = 20;
const GROUP_SIZE = 4;

/** Generates a new recovery code (in grouped form). Randomness comes from a cryptographic source. */
export function generateRecoveryCode(random: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) code += RECOVERY_CODE_ALPHABET[random(RECOVERY_CODE_ALPHABET.length)];
  return formatRecoveryCode(code);
}

/** Normalizes the code the user typed for comparison: spaces and dashes removed, converted to upper case. */
export function normalizeRecoveryCode(input: unknown): string {
  return typeof input === "string" ? input.replace(/[\s-]+/g, "").toLocaleUpperCase("en-US") : "";
}

/** Is the normalized code the right length and made only of allowed characters? */
export function isRecoveryCodeFormat(normalized: string): boolean {
  return normalized.length === RECOVERY_CODE_LENGTH && [...normalized].every((c) => RECOVERY_CODE_ALPHABET.includes(c));
}

/** "K7Q49MZD…" → "K7Q4-9MZD-…" */
export function formatRecoveryCode(normalized: string): string {
  return normalized.match(new RegExp(`.{1,${GROUP_SIZE}}`, "g"))?.join("-") ?? "";
}

/** Digest stored in the database (SHA-256 of the normalized code, lower-case hex). */
export function hashRecoveryCode(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
