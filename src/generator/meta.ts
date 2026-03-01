import type { Declaration, ObjectNode, SchemaNode } from "../transformer/types.js";
import type { XmlFieldMeta, XmlTypeMeta } from "../meta-types.js";

// ---------------------------------------------------------------------------
// XmlMeta emitter
// ---------------------------------------------------------------------------

function emitFieldMeta(meta: XmlFieldMeta): string {
  const parts: string[] = [`kind: ${JSON.stringify(meta.kind)}`, `xmlName: ${JSON.stringify(meta.xmlName)}`];
  if (meta.namespace !== undefined) parts.push(`namespace: ${JSON.stringify(meta.namespace)}`);
  if (meta.order !== undefined) parts.push(`order: ${meta.order}`);
  if (meta.choiceGroup !== undefined) parts.push(`choiceGroup: ${JSON.stringify(meta.choiceGroup)}`);
  if (meta.wrapperXmlName !== undefined) parts.push(`wrapperXmlName: ${JSON.stringify(meta.wrapperXmlName)}`);
  if (meta.default !== undefined) parts.push(`default: ${JSON.stringify(meta.default)}`);
  if (meta.fixed !== undefined) parts.push(`fixed: ${JSON.stringify(meta.fixed)}`);
  if (meta.nillable === true) parts.push(`nillable: true`);
  if (meta.isArray === true) parts.push(`isArray: true`);
  if (meta.optional === true) parts.push(`optional: true`);
  // Emit nestedMeta as a direct JS reference (not a serialised literal)
  if (meta.xmlTypeName !== undefined) parts.push(`nestedMeta: ${meta.xmlTypeName}Meta`);
  return `{ ${parts.join(", ")} }`;
}

function buildTypeMeta(decl: Declaration): XmlTypeMeta | null {
  // For union declarations (top-level choice), use metaNode if present
  const node = decl.metaNode ?? decl.node;
  if (node.kind !== "object") return null;
  return buildObjectMeta(node, decl.xmlName);
}

function buildObjectMeta(node: ObjectNode, xmlName: string): XmlTypeMeta {
  const fields: Record<string, XmlFieldMeta> = {};
  for (const f of node.fields) {
    fields[f.jsName] = f.meta;
  }
  const meta: XmlTypeMeta = {
    xmlName,
    compositor: node.compositor,
    fields,
  };
  if (Object.keys(node.choiceGroups).length > 0) {
    meta.choiceGroups = node.choiceGroups;
  }
  // Strip "Schema" suffix to recover the XML type name
  if (node.extends) meta.extends = node.extends.replace(/Schema$/, "");
  if (node.abstract) meta.abstract = true;
  if (node.mixed) meta.mixed = true;
  return meta;
}

function emitTypeMeta(meta: XmlTypeMeta): string {
  const lines: string[] = [];
  lines.push(`  xmlName: ${JSON.stringify(meta.xmlName)},`);
  if (meta.namespace !== undefined) lines.push(`  namespace: ${JSON.stringify(meta.namespace)},`);
  if (meta.extends !== undefined) lines.push(`  extends: ${JSON.stringify(meta.extends)},`);
  lines.push(`  compositor: ${JSON.stringify(meta.compositor)},`);

  // Fields
  const fieldEntries = Object.entries(meta.fields);
  if (fieldEntries.length > 0) {
    lines.push("  fields: {");
    for (const [jsName, fm] of fieldEntries) {
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(jsName) ? jsName : JSON.stringify(jsName);
      lines.push(`    ${key}: ${emitFieldMeta(fm)},`);
    }
    lines.push("  },");
  } else {
    lines.push("  fields: {},");
  }

  if (meta.choiceGroups && Object.keys(meta.choiceGroups).length > 0) {
    lines.push("  choiceGroups: {");
    for (const [id, members] of Object.entries(meta.choiceGroups)) {
      lines.push(`    ${JSON.stringify(id)}: [${members.map((m) => JSON.stringify(m)).join(", ")}],`);
    }
    lines.push("  },");
  }
  if (meta.abstract === true) lines.push("  abstract: true,");
  if (meta.mixed === true) lines.push("  mixed: true,");

  return `{\n${lines.join("\n")}\n}`;
}

export function emitMetaDeclaration(decl: Declaration): string | null {
  const meta = buildTypeMeta(decl);
  if (!meta) return null;

  const metaName = decl.jsName.replace(/Schema$/, "Meta");
  return `export const ${metaName}: XmlMeta<typeof ${decl.jsName}> = ${emitTypeMeta(meta)};`;
}

/** Returns true if this declaration should have an accompanying Meta object. */
export function hasMeta(decl: Declaration): boolean {
  return decl.node.kind === "object" || decl.metaNode !== undefined;
}
