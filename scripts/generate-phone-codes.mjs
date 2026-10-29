/**
 * Generates the phone country code list and the flag files.
 *
 *   node scripts/generate-phone-codes.mjs
 *
 * Sources (dev dependencies, versions pinned in package.json):
 *   - libphonenumber-js: international dialling codes, the main country among countries sharing a code, and the sample
 *     mobile number shown greyed out in the field (examples.mobile.json; without country code, e.g. Türkiye "501 234 56 78")
 *   - country-flag-icons (MIT): 3x2 SVG flags -> public/flags/<iso2>.svg
 *   - Turkish country names: Unicode CLDR (Node.js Intl.DisplayNames, "tr")
 *
 * Output: src/lib/domain/phone-codes.ts (do not edit by hand) and public/flags/*.svg
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCountries, getCountryCallingCode, getExampleNumber } from "libphonenumber-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FLAG_SOURCE = path.join(ROOT, "node_modules", "country-flag-icons", "3x2");
const FLAG_TARGET = path.join(ROOT, "public", "flags");
const OUTPUT = path.join(ROOT, "src", "lib", "domain", "phone-codes.ts");

const metadata = JSON.parse(await readFile(path.join(ROOT, "node_modules", "libphonenumber-js", "metadata.min.json"), "utf8"));
const examples = JSON.parse(await readFile(path.join(ROOT, "node_modules", "libphonenumber-js", "examples.mobile.json"), "utf8"));
const libVersion = JSON.parse(await readFile(path.join(ROOT, "node_modules", "libphonenumber-js", "package.json"), "utf8")).version;
const flagVersion = JSON.parse(await readFile(path.join(ROOT, "node_modules", "country-flag-icons", "package.json"), "utf8")).version;

const names = new Intl.DisplayNames(["tr"], { type: "region" });
const availableFlags = new Set((await readdir(FLAG_SOURCE)).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)));

/** Sample number in international format without the country code ("+44 7400 123456" -> "7400 123456"); empty if none. */
function exampleOf(iso2) {
  const number = getExampleNumber(iso2, examples);
  if (!number) return "";
  const prefix = `+${number.countryCallingCode} `;
  const text = number.formatInternational();
  return text.startsWith(prefix) ? text.slice(prefix.length) : "";
}

const countries = getCountries()
  .map((iso2) => ({ iso2, name: names.of(iso2) ?? iso2, dialCode: `+${getCountryCallingCode(iso2)}`, flag: availableFlags.has(iso2), example: exampleOf(iso2) }))
  .sort((a, b) => a.name.localeCompare(b.name, "tr"));

// Among countries sharing a dialling code (e.g. +1, +7, +44), the one libphonenumber treats as the main country.
const mainByDialCode = {};
for (const [code, list] of Object.entries(metadata.country_calling_codes)) {
  if (list.length > 1) mainByDialCode[`+${code}`] = list[0];
}

await rm(FLAG_TARGET, { recursive: true, force: true });
await mkdir(FLAG_TARGET, { recursive: true });
for (const country of countries) {
  if (country.flag) await copyFile(path.join(FLAG_SOURCE, `${country.iso2}.svg`), path.join(FLAG_TARGET, `${country.iso2.toLowerCase()}.svg`));
}

const lines = [
  "/**",
  " * PHONE COUNTRY CODES",
  " *",
  ` * Generated from libphonenumber-js ${libVersion} data with scripts/generate-phone-codes.mjs; do not edit by hand.`,
  " * Turkish country names come from Unicode CLDR data (Node.js Intl.DisplayNames, \"tr\"). The list is sorted by the Turkish alphabet.",
  ` * Flags are country-flag-icons ${flagVersion} (MIT) 3x2 SVG files: public/flags/<iso2>.svg. Countries with \`flag: false\` have no flag.`,
  " */",
  "/** `example`: sample mobile number shown greyed out in the field (without country code); empty if unknown. */",
  "export type PhoneCountry = { iso2: string; name: string; dialCode: string; flag: boolean; example: string };",
  "",
  "export const PHONE_COUNTRIES: readonly PhoneCountry[] = [",
  ...countries.map(
    (c) => `  { iso2: ${JSON.stringify(c.iso2)}, name: ${JSON.stringify(c.name)}, dialCode: ${JSON.stringify(c.dialCode)}, flag: ${c.flag}, example: ${JSON.stringify(c.example)} },`,
  ),
  "];",
  "",
  "/** Among countries sharing a code, the main country selected when reading a stored number (e.g. +1 -> US). */",
  "export const MAIN_COUNTRY_BY_DIAL_CODE: Readonly<Record<string, string>> = {",
  ...Object.entries(mainByDialCode)
    .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
    .map(([code, iso2]) => `  ${JSON.stringify(code)}: ${JSON.stringify(iso2)},`),
  "};",
  "",
];
await writeFile(OUTPUT, lines.join("\n"), "utf8");

const missing = countries.filter((c) => !c.flag).map((c) => `${c.iso2} (${c.name})`);
console.log(`${countries.length} countries written: ${path.relative(ROOT, OUTPUT)}`);
console.log(`${countries.length - missing.length} flags copied: ${path.relative(ROOT, FLAG_TARGET)}`);
if (missing.length > 0) console.log(`Without a flag: ${missing.join(", ")}`);
