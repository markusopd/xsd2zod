#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { xsd2zod } from "./index.js";
import type { Xsd2ZodOptions } from "./meta-types.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: "string", short: "o" },
    "absence-strategy": { type: "string" },
    "long-strategy": { type: "string" },
    "date-strategy": { type: "string" },
    coerce: { type: "boolean" },
    strict: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

if (values.help) {
  console.log(`
xsd2zod [options] <input.xsd>

Options:
  -o, --output <file>        Output file (default: stdout)
  --absence-strategy <s>     optional | nullable | nullish  (default: optional)
  --long-strategy <s>        bigint | number | string  (default: bigint)
  --date-strategy <s>        string | date  (default: string)
  --coerce                   Emit z.coerce.* types
  --strict                   Exit non-zero on any warning
  -h, --help
  -v, --version
`.trim());
  process.exit(0);
}

if (values.version) {
  // Read version from package.json at runtime
  const pkgUrl = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(pkgUrl, "utf-8")) as { version: string };
  console.log(pkg.version);
  process.exit(0);
}

const inputFile = positionals[0];
if (!inputFile) {
  console.error("Error: no input file specified. Run with --help for usage.");
  process.exit(1);
}

let xsdString: string;
try {
  xsdString = await readFile(inputFile, "utf-8");
} catch {
  console.error(`Error: cannot read file "${inputFile}"`);
  process.exit(1);
}

const opts: Xsd2ZodOptions = {};
if (values.coerce) opts.coerce = true;
if (values.strict) opts.strict = true;
const absStrat = values["absence-strategy"];
const longStrat = values["long-strategy"];
const dateStrat = values["date-strategy"];
if (absStrat) opts.absenceStrategy = absStrat as NonNullable<Xsd2ZodOptions["absenceStrategy"]>;
if (longStrat) opts.longStrategy = longStrat as NonNullable<Xsd2ZodOptions["longStrategy"]>;
if (dateStrat) opts.dateStrategy = dateStrat as NonNullable<Xsd2ZodOptions["dateStrategy"]>;

let result: Awaited<ReturnType<typeof xsd2zod>>;
try {
  result = xsd2zod(xsdString, opts);
} catch (err: unknown) {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}

for (const w of result.warnings) {
  console.error(`[${w.code}] ${w.xsdPath}: ${w.message}`);
}

if (values.output) {
  await writeFile(values.output, result.code, "utf-8");
} else {
  process.stdout.write(result.code);
}

if (values.strict && result.warnings.length > 0) {
  process.exit(1);
}
