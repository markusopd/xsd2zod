import { readFile } from "node:fs/promises";
import { parseXsd } from "./parser/index.js";
import { transform } from "./transformer/index.js";
import { generate } from "./generator/index.js";
import type { Xsd2ZodOptions, Xsd2ZodResult } from "./meta-types.js";

export type { XmlFieldMeta, XmlTypeMeta, XmlMeta, Xsd2ZodOptions, Xsd2ZodResult, Xsd2ZodWarning, WarningCode } from "./meta-types.js";

export function xsd2zod(xsdString: string, opts: Xsd2ZodOptions = {}): Xsd2ZodResult {
  const schema = parseXsd(xsdString);
  const { declarations, warnings } = transform(schema, opts);
  const code = generate(declarations);
  return { code, warnings };
}

export async function xsd2zodFile(filePath: string, opts: Xsd2ZodOptions = {}): Promise<Xsd2ZodResult> {
  const xsdString = await readFile(filePath, "utf-8");
  return xsd2zod(xsdString, opts);
}
