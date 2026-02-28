/**
 * Maps XSD built-in type local names (without prefix) to Zod expression strings.
 * These are the "base" expressions before optional/nullable/array modifiers are applied.
 */
export const PRIMITIVE_MAP: Record<string, string> = {
  // Strings
  string: "z.string()",
  normalizedString: "z.string()",
  token: "z.string()",
  language: "z.string().regex(/^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/)",
  NMTOKEN: "z.string()",
  NMTOKENS: "z.string()",
  Name: "z.string()",
  NCName: "z.string()",
  ID: "z.string()",
  IDREF: "z.string()",
  IDREFS: "z.string()",
  ENTITY: "z.string()",
  ENTITIES: "z.string()",
  QName: "z.string()",
  NOTATION: "z.string()",

  // Boolean
  boolean: "z.boolean()",

  // Integers that fit safely in JS Number
  integer: "z.number().int()",
  int: "z.number().int().min(-2147483648).max(2147483647)",
  short: "z.number().int().min(-32768).max(32767)",
  byte: "z.number().int().min(-128).max(127)",
  unsignedInt: "z.number().int().min(0).max(4294967295)",
  unsignedShort: "z.number().int().min(0).max(65535)",
  unsignedByte: "z.number().int().min(0).max(255)",
  positiveInteger: "z.number().int().positive()",
  nonNegativeInteger: "z.number().int().min(0)",
  nonPositiveInteger: "z.number().int().max(0)",
  negativeInteger: "z.number().int().negative()",

  // 64-bit integers — handled via longStrategy option, placeholder replaced at runtime
  long: "__LONG__",
  unsignedLong: "__UNSIGNED_LONG__",

  // Floating point
  decimal: "z.number()",
  float: "z.number()",
  double: "z.number()",

  // Date/time — handled via dateStrategy option, placeholder replaced at runtime
  date: "__DATE__",
  dateTime: "__DATETIME__",
  time: "z.string().time()",
  duration: 'z.string().regex(/^-?P(?:\\d+Y)?(?:\\d+M)?(?:\\d+D)?(?:T(?:\\d+H)?(?:\\d+M)?(?:\\d+(?:\\.\\d+)?S)?)?$/)',
  gYear: "z.string()",
  gYearMonth: "z.string()",
  gMonth: "z.string()",
  gDay: "z.string()",
  gMonthDay: "z.string()",

  // Binary
  base64Binary: "z.string().base64()",
  hexBinary: "z.string().regex(/^[0-9a-fA-F]*$/)",

  // URI
  anyURI: "z.string().url()",

  // Wildcards
  anyType: "z.unknown()",
  anySimpleType: "z.union([z.string(), z.number(), z.boolean()])",
};

const XSD_NS_URIS = new Set([
  "http://www.w3.org/2001/XMLSchema",
  "http://www.w3.org/1999/XMLSchema",
]);

/**
 * Resolve a type reference to a Zod expression string for built-in types,
 * or return undefined if it is a user-defined type reference.
 *
 * Handles both prefixed ("xs:string") and unprefixed ("string") references.
 */
export function resolveBuiltIn(
  typeRef: string,
  namespaces: Record<string, string>,
  opts: { longStrategy: string; dateStrategy: string }
): string | undefined {
  let localName: string;

  const colon = typeRef.indexOf(":");
  if (colon !== -1) {
    const prefix = typeRef.slice(0, colon);
    const ns = namespaces[prefix];
    if (!ns || !XSD_NS_URIS.has(ns)) return undefined;
    localName = typeRef.slice(colon + 1);
  } else {
    // Unprefixed — only treat as built-in if we have a default XSD namespace
    const defaultNs = namespaces[""];
    if (!defaultNs || !XSD_NS_URIS.has(defaultNs)) {
      // Still try the local name — many simple schemas omit the namespace
      localName = typeRef;
    } else {
      localName = typeRef;
    }
  }

  const expr = PRIMITIVE_MAP[localName];
  if (!expr) return undefined;

  // Resolve strategy placeholders
  return expr
    .replace("__LONG__", opts.longStrategy === "bigint"
      ? "z.bigint()"
      : opts.longStrategy === "string"
        ? 'z.string().regex(/^-?[0-9]+$/)'
        : "z.number().int()")
    .replace("__UNSIGNED_LONG__", opts.longStrategy === "bigint"
      ? "z.bigint().min(0n)"
      : opts.longStrategy === "string"
        ? 'z.string().regex(/^[0-9]+$/)'
        : "z.number().int().min(0)")
    .replace("__DATE__", opts.dateStrategy === "date"
      ? "z.date()"
      : "z.string().date()")
    .replace("__DATETIME__", opts.dateStrategy === "date"
      ? "z.date()"
      : "z.string().datetime()");
}

/** Strip the namespace prefix from a type reference. */
export function localName(typeRef: string): string {
  const colon = typeRef.indexOf(":");
  return colon === -1 ? typeRef : typeRef.slice(colon + 1);
}
