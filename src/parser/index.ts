import { XMLParser } from "fast-xml-parser";
import type {
  XsdAttribute,
  XsdChoice,
  XsdComplexType,
  XsdCompositorChild,
  XsdElement,
  XsdRestriction,
  XsdSchema,
  XsdSimpleType,
} from "./types.js";

// ---------------------------------------------------------------------------
// XML parsing helpers
// ---------------------------------------------------------------------------

function parseXml(xsd: string): Record<string, unknown> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    trimValues: true,
    // Preserve text content when there are also attributes
    textNodeName: "#text",
  });
  return parser.parse(xsd) as Record<string, unknown>;
}

/** Ensure a value is always an array. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(node: Record<string, unknown>, name: string): string | undefined {
  const v = node[`@_${name}`];
  return typeof v === "string" ? v : undefined;
}

function numAttr(
  node: Record<string, unknown>,
  name: string,
  fallback: number
): number {
  const v = attr(node, name);
  if (v === undefined) return fallback;
  if (v === "unbounded") return Infinity;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function maxOccursAttr(
  node: Record<string, unknown>,
  fallback: number | "unbounded"
): number | "unbounded" {
  const v = attr(node, "maxOccurs");
  if (v === undefined) return fallback;
  if (v === "unbounded") return "unbounded";
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

// ---------------------------------------------------------------------------
// Namespace prefix detection
// ---------------------------------------------------------------------------

/**
 * Walk the root element's attributes to find the prefix used for the
 * XSD namespace (http://www.w3.org/2001/XMLSchema).  Returns "xs" as default.
 */
function detectXsPrefix(rawRoot: Record<string, unknown>): string {
  const XSD_NS = "http://www.w3.org/2001/XMLSchema";
  for (const [key, val] of Object.entries(rawRoot)) {
    if (key.startsWith("@_xmlns:") && val === XSD_NS) {
      return key.slice("@_xmlns:".length);
    }
  }
  return "xs";
}

/**
 * Strip namespace prefix from a key, e.g. "xs:element" → "element",
 * "xsd:complexType" → "complexType".
 */
function stripPrefix(key: string): string {
  const colon = key.indexOf(":");
  return colon === -1 ? key : key.slice(colon + 1);
}

/**
 * Recursively normalise all object keys by stripping their namespace prefix,
 * so the rest of the code can work with plain local names.
 */
function normalizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeKeys);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Keep attribute keys (@_name) intact; only strip from element keys
      const normalKey = k.startsWith("@_") ? k : stripPrefix(k);
      // If normalised key already exists, merge into array
      if (Object.prototype.hasOwnProperty.call(out, normalKey)) {
        const existing = out[normalKey];
        const incoming = normalizeKeys(v);
        out[normalKey] = Array.isArray(existing)
          ? [...existing, ...(Array.isArray(incoming) ? incoming : [incoming])]
          : [existing, ...(Array.isArray(incoming) ? incoming : [incoming])];
      } else {
        out[normalKey] = normalizeKeys(v);
      }
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Namespace collection
// ---------------------------------------------------------------------------

function collectNamespaces(rawRoot: Record<string, unknown>): Record<string, string> {
  const ns: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawRoot)) {
    if (key.startsWith("@_xmlns:") && typeof val === "string") {
      ns[key.slice("@_xmlns:".length)] = val;
    } else if (key === "@_xmlns" && typeof val === "string") {
      ns[""] = val;
    }
  }
  return ns;
}

// ---------------------------------------------------------------------------
// Build XsdSchema from normalised tree
// ---------------------------------------------------------------------------

type Node = Record<string, unknown>;

function toNode(v: unknown): Node | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Node;
  }
  return undefined;
}

function parseAttribute(raw: Node): XsdAttribute {
  const result: XsdAttribute = {
    name: attr(raw, "name") ?? "",
    type: attr(raw, "type") ?? "xs:string",
    use: (attr(raw, "use") as XsdAttribute["use"]) ?? "optional",
  };
  const def = attr(raw, "default");
  const fixed = attr(raw, "fixed");
  if (def !== undefined) result.default = def;
  if (fixed !== undefined) result.fixed = fixed;
  return result;
}

function parseRestriction(raw: Node): XsdRestriction {
  const base = attr(raw, "base") ?? "";
  const enumValues = asArray(raw["enumeration"] as Node | Node[]).map(
    (e) => attr(e, "value") ?? ""
  );
  const facet = (name: string): string | undefined => {
    const n = toNode(raw[name]);
    return n ? attr(n, "value") : undefined;
  };
  const numFacet = (name: string): number | undefined => {
    const v = facet(name);
    return v !== undefined ? parseFloat(v) : undefined;
  };

  const r: XsdRestriction = { base };
  if (enumValues.length > 0) r.enumeration = enumValues;
  const minLength = numFacet("minLength");
  const maxLength = numFacet("maxLength");
  const length = numFacet("length");
  const pattern = facet("pattern");
  const minInclusive = facet("minInclusive");
  const maxInclusive = facet("maxInclusive");
  const minExclusive = facet("minExclusive");
  const maxExclusive = facet("maxExclusive");
  const totalDigits = numFacet("totalDigits");
  const fractionDigits = numFacet("fractionDigits");
  if (minLength !== undefined) r.minLength = minLength;
  if (maxLength !== undefined) r.maxLength = maxLength;
  if (length !== undefined) r.length = length;
  if (pattern !== undefined) r.pattern = pattern;
  if (minInclusive !== undefined) r.minInclusive = minInclusive;
  if (maxInclusive !== undefined) r.maxInclusive = maxInclusive;
  if (minExclusive !== undefined) r.minExclusive = minExclusive;
  if (maxExclusive !== undefined) r.maxExclusive = maxExclusive;
  if (totalDigits !== undefined) r.totalDigits = totalDigits;
  if (fractionDigits !== undefined) r.fractionDigits = fractionDigits;
  return r;
}

function parseSimpleType(raw: Node): XsdSimpleType {
  const name = attr(raw, "name");
  const restrictionNode = toNode(raw["restriction"]);
  const listNode = toNode(raw["list"]);
  const unionNode = toNode(raw["union"]);

  return {
    kind: "simple",
    ...(name !== undefined && { name }),
    ...(restrictionNode && { restriction: parseRestriction(restrictionNode) }),
    ...(listNode && { list: { itemType: attr(listNode, "itemType") ?? "" } }),
    ...(unionNode && {
      union: {
        memberTypes: (attr(unionNode, "memberTypes") ?? "").split(/\s+/).filter(Boolean),
      },
    }),
  };
}

function parseElement(raw: Node): XsdElement {
  const minOccurs = numAttr(raw, "minOccurs", 1);
  const maxOccurs = maxOccursAttr(raw, 1);

  let inlineType: XsdElement["inlineType"];
  const ctNode = toNode(raw["complexType"]);
  const stNode = toNode(raw["simpleType"]);
  if (ctNode) {
    inlineType = parseComplexType(ctNode);
  } else if (stNode) {
    inlineType = parseSimpleType(stNode);
  }

  const el: XsdElement = {
    name: attr(raw, "name") ?? "",
    minOccurs,
    maxOccurs,
    nillable: attr(raw, "nillable") === "true",
  };
  const type = attr(raw, "type");
  const def = attr(raw, "default");
  const fixed = attr(raw, "fixed");
  if (type !== undefined) el.type = type;
  if (inlineType !== undefined) el.inlineType = inlineType;
  if (def !== undefined) el.default = def;
  if (fixed !== undefined) el.fixed = fixed;
  return el;
}

function parseCompositorChildren(raw: Node): XsdCompositorChild[] {
  const children: XsdCompositorChild[] = [];

  for (const elementRaw of asArray(raw["element"] as Node | Node[])) {
    children.push(parseElement(elementRaw));
  }
  for (const choiceRaw of asArray(raw["choice"] as Node | Node[])) {
    children.push(parseChoiceNode(choiceRaw));
  }
  // xs:group references
  for (const groupRaw of asArray(raw["group"] as Node | Node[])) {
    const ref = attr(groupRaw, "ref");
    if (ref) {
      children.push({ kind: "group", ref });
    }
  }

  return children;
}

function parseChoiceNode(raw: Node): XsdChoice {
  return {
    minOccurs: numAttr(raw, "minOccurs", 1),
    maxOccurs: maxOccursAttr(raw, 1),
    branches: parseCompositorChildren(raw),
  };
}

function parseComplexType(raw: Node): XsdComplexType {
  const attributes = asArray(raw["attribute"] as Node | Node[]).map(parseAttribute);
  const abstract = attr(raw, "abstract") === "true";
  const mixed = attr(raw, "mixed") === "true";

  // xs:simpleContent
  const simpleContentNode = toNode(raw["simpleContent"]);
  if (simpleContentNode) {
    const extNode = toNode(simpleContentNode["extension"]);
    if (extNode) {
      const scAttrs = asArray(extNode["attribute"] as Node | Node[]).map(parseAttribute);
      return {
        kind: "complex",
        compositor: "none",
        children: [],
        attributes: [...attributes, ...scAttrs],
        simpleContent: {
          base: attr(extNode, "base") ?? "",
          attributes: scAttrs,
        },
        mixed: false,
        abstract,
      };
    }
  }

  // xs:complexContent with xs:extension
  const complexContentNode = toNode(raw["complexContent"]);
  if (complexContentNode) {
    const extNode = toNode(complexContentNode["extension"]);
    if (extNode) {
      const { compositor, children } = detectCompositor(extNode);
      const extAttrs = asArray(extNode["attribute"] as Node | Node[]).map(parseAttribute);
      return {
        kind: "complex",
        compositor,
        children,
        attributes: [...attributes, ...extAttrs],
        extension: {
          base: attr(extNode, "base") ?? "",
          children,
          attributes: extAttrs,
          compositor,
        },
        mixed,
        abstract,
      };
    }
  }

  const { compositor, children } = detectCompositor(raw);
  return {
    kind: "complex",
    compositor,
    children,
    attributes,
    mixed,
    abstract,
  };
}

function detectCompositor(
  raw: Node
): { compositor: XsdComplexType["compositor"]; children: XsdCompositorChild[] } {
  const sequenceNode = toNode(raw["sequence"]);
  if (sequenceNode) {
    return { compositor: "sequence", children: parseCompositorChildren(sequenceNode) };
  }
  const allNode = toNode(raw["all"]);
  if (allNode) {
    return { compositor: "all", children: parseCompositorChildren(allNode) };
  }
  const choiceNode = toNode(raw["choice"]);
  if (choiceNode) {
    return {
      compositor: "choice",
      children: [parseChoiceNode(choiceNode)],
    };
  }
  return { compositor: "none", children: [] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseXsd(xsd: string): XsdSchema {
  const rawParsed = parseXml(xsd);

  // Detect the XSD namespace prefix from the raw (pre-normalised) root
  const rawRoot =
    (rawParsed["xs:schema"] ??
      rawParsed["xsd:schema"] ??
      Object.values(rawParsed).find(
        (v) => v !== null && typeof v === "object"
      )) as Record<string, unknown> | undefined;

  const namespaces = rawRoot ? collectNamespaces(rawRoot) : {};
  const targetNamespace = rawRoot ? attr(rawRoot, "targetNamespace") : undefined;

  const normalized = normalizeKeys(rawParsed) as Record<string, unknown>;
  const schemaNode = toNode(normalized["schema"]);
  if (!schemaNode) {
    return { namespaces, elements: [], complexTypes: [], simpleTypes: [] };
  }

  const elements = asArray(schemaNode["element"] as Node | Node[]).map(parseElement);
  const complexTypes = asArray(schemaNode["complexType"] as Node | Node[]).map((n) => {
    const ct = parseComplexType(n);
    const name = attr(n, "name");
    if (name !== undefined) ct.name = name;
    return ct;
  });
  const simpleTypes = asArray(schemaNode["simpleType"] as Node | Node[]).map((n) => {
    const st = parseSimpleType(n);
    const name = attr(n, "name");
    if (name !== undefined) st.name = name;
    return st;
  });

  return {
    ...(targetNamespace !== undefined && { targetNamespace }),
    namespaces,
    elements,
    complexTypes,
    simpleTypes,
  };
}
