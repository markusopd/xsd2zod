import type {
  XsdAttribute,
  XsdChoice,
  XsdComplexType,
  XsdCompositorChild,
  XsdElement,
  XsdSchema,
  XsdSimpleType,
} from "../parser/types.js";
import type { Xsd2ZodOptions, Xsd2ZodWarning, XmlFieldMeta } from "../meta-types.js";
import type {
  ArrayNode,
  Declaration,
  EnumNode,
  ObjectField,
  ObjectNode,
  PrimitiveNode,
  SchemaNode,
  UnknownNode,
} from "./types.js";
import { resolveBuiltIn } from "./primitives.js";

// ---------------------------------------------------------------------------
// Transformer context
// ---------------------------------------------------------------------------

interface Context {
  schema: XsdSchema;
  opts: Required<Xsd2ZodOptions>;
  warnings: Xsd2ZodWarning[];
  /** All named complex/simple types indexed by local name */
  typeIndex: Map<string, XsdComplexType | XsdSimpleType>;
  /** Track which types we are currently transforming (for cycle detection) */
  inProgress: Set<string>;
  /** Already-transformed named types (cache) */
  cache: Map<string, SchemaNode>;
}

function warn(ctx: Context, code: Xsd2ZodWarning["code"], message: string, xsdPath: string) {
  if (ctx.opts.strict) {
    throw new Error(`[${code}] ${xsdPath}: ${message}`);
  }
  ctx.warnings.push({ code, message, xsdPath });
}

// ---------------------------------------------------------------------------
// Type resolution helpers
// ---------------------------------------------------------------------------

function stripPrefix(ref: string): string {
  const c = ref.indexOf(":");
  return c === -1 ? ref : ref.slice(c + 1);
}

function resolveTypeRef(
  typeRef: string,
  ctx: Context,
  xsdPath: string
): SchemaNode {
  // Try built-in first
  const builtIn = resolveBuiltIn(typeRef, ctx.schema.namespaces, {
    longStrategy: ctx.opts.longStrategy,
    dateStrategy: ctx.opts.dateStrategy,
  });
  if (builtIn) {
    return { kind: "primitive", zodExpr: applyCoerce(builtIn, ctx) };
  }

  const local = stripPrefix(typeRef);

  // Cycle detection — emit z.lazy to break the cycle
  if (ctx.inProgress.has(local)) {
    warn(ctx, "CIRCULAR_REF", `Circular reference to "${local}"`, xsdPath);
    return { kind: "lazy", ref: `${local}Schema`, tsType: local };
  }

  const typeDef = ctx.typeIndex.get(local);
  if (!typeDef) {
    warn(ctx, "UNRESOLVED_TYPE_REF", `Cannot resolve type "${typeRef}"`, xsdPath);
    return { kind: "unknown" };
  }

  // Named type — emit a reference to its schema identifier rather than inlining.
  // The type will be emitted as its own declaration by the main transform() loop.
  // Ensure it is transformed and cached so the generator knows it exists.
  if (!ctx.cache.has(local)) {
    ctx.inProgress.add(local);
    const node = typeDef.kind === "simple"
      ? transformSimpleType(typeDef, ctx, xsdPath)
      : transformComplexType(typeDef as XsdComplexType, ctx, xsdPath);
    ctx.inProgress.delete(local);
    ctx.cache.set(local, node);
  }

  return { kind: "ref", ref: `${local}Schema` };
}

function applyCoerce(expr: string, ctx: Context): string {
  if (!ctx.opts.coerce) return expr;
  return expr
    .replace(/^z\.number\(\)/, "z.coerce.number()")
    .replace(/^z\.boolean\(\)/, "z.coerce.boolean()")
    .replace(/^z\.date\(\)/, "z.coerce.date()");
}

// ---------------------------------------------------------------------------
// Simple type transformer
// ---------------------------------------------------------------------------

function transformSimpleType(
  st: XsdSimpleType,
  ctx: Context,
  xsdPath: string
): SchemaNode {
  if (st.restriction) {
    const r = st.restriction;
    // Enumeration → EnumNode
    if (r.enumeration && r.enumeration.length > 0) {
      const node: EnumNode = { kind: "enum", values: r.enumeration };
      return node;
    }

    // Resolve base type and layer restrictions
    const baseExpr = resolveBaseExpr(r.base, ctx, xsdPath);
    let expr = baseExpr;

    if (r.minLength !== undefined) expr += `.min(${r.minLength})`;
    if (r.maxLength !== undefined) expr += `.max(${r.maxLength})`;
    if (r.length !== undefined) expr += `.length(${r.length})`;
    if (r.minInclusive !== undefined) expr += `.min(${r.minInclusive})`;
    if (r.maxInclusive !== undefined) expr += `.max(${r.maxInclusive})`;
    if (r.minExclusive !== undefined) expr += `.gt(${r.minExclusive})`;
    if (r.maxExclusive !== undefined) expr += `.lt(${r.maxExclusive})`;

    if (r.pattern !== undefined) {
      const translated = translateXsdRegex(r.pattern, ctx, xsdPath);
      if (translated !== null) {
        expr += `.regex(${translated})`;
      }
    }

    if (r.totalDigits !== undefined || r.fractionDigits !== undefined) {
      // These can't be expressed cleanly; emit as superRefine
      const checks: string[] = [];
      if (r.totalDigits !== undefined) {
        checks.push(`String(Math.abs(v)).replace('.','').replace(/^0+/,'').length <= ${r.totalDigits}`);
      }
      if (r.fractionDigits !== undefined) {
        checks.push(`(String(v).split('.')[1]?.length ?? 0) <= ${r.fractionDigits}`);
      }
      expr += `.superRefine((v, c) => { if (!(${checks.join(" && ")})) c.addIssue({ code: "custom", message: "Numeric precision constraint violated" }); })`;
    }

    return { kind: "primitive", zodExpr: expr };
  }

  if (st.list) {
    // xs:list — whitespace-delimited string of itemType values
    const itemBase = resolveBaseExpr(st.list.itemType, ctx, xsdPath);
    return {
      kind: "primitive",
      zodExpr: `z.preprocess((v) => typeof v === "string" ? v.trim().split(/\\s+/).filter(Boolean) : v, z.array(${itemBase}))`,
    };
  }

  if (st.union) {
    // xs:union — value may be any of the member types
    const members = st.union.memberTypes.map((mt) =>
      resolveBaseExpr(mt, ctx, xsdPath)
    );
    return { kind: "primitive", zodExpr: `z.union([${members.join(", ")}])` };
  }

  return { kind: "unknown" };
}

/**
 * Resolve a type reference to a raw Zod expression string
 * (only for use where we need an inline expression, not a named reference).
 */
function resolveBaseExpr(typeRef: string, ctx: Context, xsdPath: string): string {
  const builtIn = resolveBuiltIn(typeRef, ctx.schema.namespaces, {
    longStrategy: ctx.opts.longStrategy,
    dateStrategy: ctx.opts.dateStrategy,
  });
  if (builtIn) return applyCoerce(builtIn, ctx);

  // User-defined type — inline it if it resolves to a primitive expression,
  // otherwise fall back to z.unknown() with a warning
  const local = stripPrefix(typeRef);
  const typeDef = ctx.typeIndex.get(local);
  if (!typeDef) {
    warn(ctx, "UNRESOLVED_TYPE_REF", `Cannot resolve type "${typeRef}"`, xsdPath);
    return "z.unknown()";
  }
  const node = typeDef.kind === "simple"
    ? transformSimpleType(typeDef, ctx, xsdPath)
    : transformComplexType(typeDef as XsdComplexType, ctx, xsdPath);

  return nodeToInlineExpr(node);
}

/** Convert a SchemaNode to an inline Zod expression string (best-effort). */
function nodeToInlineExpr(node: SchemaNode): string {
  switch (node.kind) {
    case "primitive": return node.zodExpr;
    case "enum": return `z.enum([${node.values.map((v) => JSON.stringify(v)).join(", ")}])`;
    case "unknown": return "z.unknown()";
    default: return "z.unknown()";
  }
}

// ---------------------------------------------------------------------------
// XSD regex → JS regex translation (partial)
// ---------------------------------------------------------------------------

function translateXsdRegex(
  pattern: string,
  ctx: Context,
  xsdPath: string
): string | null {
  // XSD patterns that use constructs with no JS equivalent
  const unsupportedPatterns = [
    /\\[icIdIDWwBb]/, // XSD-specific escape sequences not in JS
    /\[.*?-\[/,       // Character class subtraction
  ];
  for (const re of unsupportedPatterns) {
    if (re.test(pattern)) {
      warn(
        ctx,
        "PARTIAL_REGEX",
        `XSD pattern "${pattern}" contains constructs not supported in JS regex; falling back to z.string()`,
        xsdPath
      );
      return null;
    }
  }
  // XSD patterns implicitly anchor the full string; add anchors if absent
  const anchored =
    (pattern.startsWith("^") ? "" : "^") +
    pattern +
    (pattern.endsWith("$") ? "" : "$");
  return `/${anchored}/`;
}

// ---------------------------------------------------------------------------
// Complex type transformer
// ---------------------------------------------------------------------------

let choiceCounter = 0;

function transformComplexType(
  ct: XsdComplexType,
  ctx: Context,
  xsdPath: string
): SchemaNode {
  if (ct.abstract) {
    warn(ctx, "ABSTRACT_TYPE", `Abstract type emitted as its base type`, xsdPath);
  }

  // simpleContent: text + attributes
  if (ct.simpleContent) {
    const sc = ct.simpleContent;
    const textExpr = resolveBaseExpr(sc.base, ctx, xsdPath);
    const fields: ObjectField[] = [
      {
        jsName: "$text",
        node: { kind: "primitive", zodExpr: textExpr },
        meta: { kind: "text", xmlName: "#text" },
      },
      ...transformAttributes(ct.attributes, ctx, xsdPath),
    ];
    return {
      kind: "object",
      fields,
      compositor: "none",
      choiceGroups: {},
      abstract: ct.abstract,
      mixed: false,
    };
  }

  // Extension (xs:complexContent / xs:extension)
  const extendsName = ct.extension?.base
    ? `${stripPrefix(ct.extension.base)}Schema`
    : undefined;

  const compositor = ct.compositor;
  const { fields, choiceGroups } = transformChildren(
    ct.extension?.children ?? ct.children,
    ct.extension?.compositor ?? compositor,
    ctx,
    xsdPath
  );

  const attrFields = transformAttributes(ct.attributes, ctx, xsdPath);

  return {
    kind: "object",
    ...(extendsName && { extends: extendsName }),
    fields: [...fields, ...attrFields],
    compositor,
    choiceGroups,
    abstract: ct.abstract,
    mixed: ct.mixed,
  };
}

function transformAttributes(
  attrs: XsdAttribute[],
  ctx: Context,
  xsdPath: string
): ObjectField[] {
  return attrs.map((a) => {
    const typeNode = resolveTypeRef(a.type, ctx, `${xsdPath}.@${a.name}`);
    const node: SchemaNode =
      a.use === "optional"
        ? applyAbsence({ ...typeNode }, ctx)
        : typeNode;
    const meta: XmlFieldMeta = {
      kind: "attribute",
      xmlName: a.name,
      ...(a.default !== undefined && { default: a.default }),
      ...(a.fixed !== undefined && { fixed: a.fixed }),
    };
    return { jsName: toCamelCase(a.name), node, meta };
  });
}

function transformChildren(
  children: XsdCompositorChild[],
  compositor: XsdComplexType["compositor"],
  ctx: Context,
  xsdPath: string
): { fields: ObjectField[]; choiceGroups: Record<string, string[]> } {
  const fields: ObjectField[] = [];
  const choiceGroups: Record<string, string[]> = {};
  let order = 0;

  for (const child of children) {
    if ("kind" in child && child.kind === "group") {
      warn(ctx, "UNSUPPORTED_CONSTRUCT", `xs:group references are not yet supported`, xsdPath);
      continue;
    }

    if ("branches" in child) {
      // xs:choice
      const result = transformChoice(child, order, ctx, xsdPath);
      for (const f of result.fields) fields.push(f);
      for (const [k, v] of Object.entries(result.choiceGroups)) {
        choiceGroups[k] = v;
      }
      // all branches share the same order slot
      order++;
      continue;
    }

    // xs:element
    const el = child as XsdElement;
    const fieldOrder = compositor === "sequence" ? order++ : undefined;
    fields.push(transformElement(el, fieldOrder, ctx, xsdPath));
  }

  return { fields, choiceGroups };
}

function transformChoice(
  choice: XsdChoice,
  orderSlot: number,
  ctx: Context,
  xsdPath: string
): { fields: ObjectField[]; choiceGroups: Record<string, string[]> } {
  const groupId = `choice_${choiceCounter++}`;
  const fields: ObjectField[] = [];
  const memberNames: string[] = [];

  for (const branch of choice.branches) {
    if ("kind" in branch && branch.kind === "group") {
      warn(ctx, "UNSUPPORTED_CONSTRUCT", "xs:group in xs:choice not yet supported", xsdPath);
      continue;
    }
    if ("branches" in branch) {
      // Nested choice — flatten for now
      const inner = transformChoice(branch, orderSlot, ctx, xsdPath);
      for (const f of inner.fields) {
        fields.push({ ...f, meta: { ...f.meta, choiceGroup: groupId, order: orderSlot } });
        memberNames.push(f.jsName);
      }
      continue;
    }
    const el = branch as XsdElement;
    const jsName = toCamelCase(el.name);
    memberNames.push(jsName);

    // In a choice every branch is effectively optional at the object level
    const elementNode = elementSchemaNode(el, ctx, xsdPath);
    const optionalNode = applyAbsence(elementNode, ctx);

    const meta: XmlFieldMeta = {
      kind: "element",
      xmlName: el.name,
      order: orderSlot,
      choiceGroup: groupId,
      ...(el.nillable && { nillable: true }),
      ...(el.default !== undefined && { default: el.default }),
      ...(el.fixed !== undefined && { fixed: el.fixed }),
    };
    fields.push({ jsName, node: optionalNode, meta });
  }

  return { fields, choiceGroups: { [groupId]: memberNames } };
}

function transformElement(
  el: XsdElement,
  order: number | undefined,
  ctx: Context,
  xsdPath: string
): ObjectField {
  const jsName = toCamelCase(el.name);
  const elementPath = `${xsdPath}.${el.name}`;

  let node = elementSchemaNode(el, ctx, elementPath);

  // Cardinality
  const isArray =
    el.maxOccurs === "unbounded" || (typeof el.maxOccurs === "number" && el.maxOccurs > 1);
  if (isArray) {
    node = { kind: "array", item: node };
  }
  if (el.minOccurs === 0) {
    node = applyAbsence(node, ctx);
  }
  if (el.nillable) {
    node = { ...node, nullable: true };
  }

  const meta: XmlFieldMeta = {
    kind: "element",
    xmlName: el.name,
    ...(order !== undefined && { order }),
    ...(el.nillable && { nillable: true }),
    ...(el.default !== undefined && { default: el.default }),
    ...(el.fixed !== undefined && { fixed: el.fixed }),
  };

  return { jsName, node, meta };
}

/** Resolve the core schema node for an element (without cardinality/optionality). */
function elementSchemaNode(
  el: XsdElement,
  ctx: Context,
  xsdPath: string
): SchemaNode {
  if (el.inlineType) {
    if (el.inlineType.kind === "simple") {
      return transformSimpleType(el.inlineType, ctx, xsdPath);
    } else {
      return transformComplexType(el.inlineType as XsdComplexType, ctx, xsdPath);
    }
  }
  if (el.type) {
    return resolveTypeRef(el.type, ctx, xsdPath);
  }
  return { kind: "unknown" };
}

function applyAbsence(node: SchemaNode, ctx: Context): SchemaNode {
  const strategy = ctx.opts.absenceStrategy;
  if (strategy === "optional") return { ...node, optional: true };
  if (strategy === "nullable") return { ...node, nullable: true };
  return { ...node, optional: true, nullable: true };
}

// ---------------------------------------------------------------------------
// Identifier helpers
// ---------------------------------------------------------------------------

export function toCamelCase(name: string): string {
  return name
    .replace(/[-_.](.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const DEFAULT_OPTS: Required<Xsd2ZodOptions> = {
  coerce: false,
  absenceStrategy: "optional",
  longStrategy: "bigint",
  dateStrategy: "string",
  strict: false,
};

export function transform(
  schema: XsdSchema,
  opts: Xsd2ZodOptions = {}
): { declarations: Declaration[]; warnings: Xsd2ZodWarning[] } {
  const resolvedOpts: Required<Xsd2ZodOptions> = { ...DEFAULT_OPTS, ...opts };
  const warnings: Xsd2ZodWarning[] = [];

  // Build type index (complex + simple, keyed by local name)
  const typeIndex = new Map<string, XsdComplexType | XsdSimpleType>();
  for (const ct of schema.complexTypes) {
    if (ct.name) typeIndex.set(ct.name, ct);
  }
  for (const st of schema.simpleTypes) {
    if (st.name) typeIndex.set(st.name, st);
  }

  const ctx: Context = {
    schema,
    opts: resolvedOpts,
    warnings,
    typeIndex,
    inProgress: new Set(),
    cache: new Map(),
  };

  choiceCounter = 0;

  const declarations: Declaration[] = [];

  // Named complex types
  for (const ct of schema.complexTypes) {
    if (!ct.name) continue;
    const node = transformComplexType(ct, ctx, ct.name);
    ctx.cache.set(ct.name, node);
    declarations.push({ jsName: `${ct.name}Schema`, xmlName: ct.name, node });
  }

  // Named simple types
  for (const st of schema.simpleTypes) {
    if (!st.name) continue;
    if (ctx.cache.has(st.name)) continue;
    const node = transformSimpleType(st, ctx, st.name);
    ctx.cache.set(st.name, node);
    declarations.push({ jsName: `${st.name}Schema`, xmlName: st.name, node });
  }

  // Top-level elements
  for (const el of schema.elements) {
    if (!el.name) continue;
    const node = elementSchemaNode(el, ctx, el.name);
    const jsName = `${toCamelCase(el.name)}Schema`;
    declarations.push({ jsName, xmlName: el.name, node });
  }

  return { declarations, warnings };
}
