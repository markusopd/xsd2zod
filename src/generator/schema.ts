import type { Declaration, ObjectField, SchemaNode } from "../transformer/types.js";

// ---------------------------------------------------------------------------
// Zod expression emitter
// ---------------------------------------------------------------------------

export function emitNodeExpr(node: SchemaNode): string {
  let expr = coreExpr(node);
  if (node.nullable) expr += ".nullable()";
  if (node.optional) expr += ".optional()";
  return expr;
}

function coreExpr(node: SchemaNode): string {
  switch (node.kind) {
    case "primitive":
      return node.zodExpr;

    case "unknown":
      return "z.unknown()";

    case "enum":
      if (node.values.length === 0) return "z.never()";
      if (node.values.length === 1) return `z.literal(${JSON.stringify(node.values[0])})`;
      return `z.enum([${node.values.map((v) => JSON.stringify(v)).join(", ")}])`;

    case "array":
      return `z.array(${emitNodeExpr(node.item)})`;

    case "union":
      if (node.members.length === 0) return "z.never()";
      if (node.members.length === 1) return emitNodeExpr(node.members[0]!);
      return `z.union([${node.members.map(emitNodeExpr).join(", ")}])`;

    case "ref":
      return node.ref;

    case "lazy":
      return `z.lazy(() => ${node.ref})`;

    case "object":
      return emitObjectExpr(node);
  }
}

function emitObjectExpr(node: Extract<SchemaNode, { kind: "object" }>): string {
  const entries = node.fields.map((f: ObjectField) => {
    const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(f.jsName)
      ? f.jsName
      : JSON.stringify(f.jsName);
    return `${key}: ${emitNodeExpr(f.node)}`;
  });
  const obj = `z.object({\n${entries.map((e) => `  ${e}`).join(",\n")}\n})`;
  return node.extends ? `${node.extends}.extend({\n${entries.map((e) => `  ${e}`).join(",\n")}\n})` : obj;
}

// ---------------------------------------------------------------------------
// Declaration emitter
// ---------------------------------------------------------------------------

/**
 * Topologically sort declarations so that referenced schemas are declared
 * before the schemas that reference them.
 * Circular references (detected via LazyNode) are left in place.
 */
export function topoSort(declarations: Declaration[]): Declaration[] {
  const byName = new Map(declarations.map((d) => [d.jsName, d]));
  const sorted: Declaration[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function visit(jsName: string) {
    if (visited.has(jsName)) return;
    if (inStack.has(jsName)) return; // circular — handled by z.lazy

    inStack.add(jsName);
    const decl = byName.get(jsName);
    if (decl) {
      for (const dep of collectDeps(decl.node)) {
        visit(dep);
      }
      if (!visited.has(jsName)) {
        sorted.push(decl);
        visited.add(jsName);
      }
    }
    inStack.delete(jsName);
  }

  for (const d of declarations) visit(d.jsName);
  return sorted;
}

function collectDeps(node: SchemaNode): string[] {
  switch (node.kind) {
    case "object":
      return node.fields.flatMap((f) => collectDeps(f.node))
        .concat(node.extends ? [node.extends] : []);
    case "array":
      return collectDeps(node.item);
    case "union":
      return node.members.flatMap(collectDeps);
    case "ref":
      return [node.ref];
    case "lazy":
      return []; // intentionally omit — this is the cycle break
    default:
      return [];
  }
}

export function emitSchemaDeclaration(decl: Declaration): string {
  const node = decl.node;
  const expr = emitNodeExpr(node);

  // Circular refs need explicit type annotation
  if (needsTypeAnnotation(node)) {
    return `export const ${decl.jsName}: z.ZodType<z.infer<typeof ${decl.jsName}>> = ${expr};`;
  }
  return `export const ${decl.jsName} = ${expr};`;
}

function needsTypeAnnotation(node: SchemaNode): boolean {
  // If the declaration itself is lazy, or contains a lazy node
  return containsLazy(node);
}

function containsLazy(node: SchemaNode): boolean {
  switch (node.kind) {
    case "lazy": return true;
    case "object": return node.fields.some((f) => containsLazy(f.node));
    case "array": return containsLazy(node.item);
    case "union": return node.members.some(containsLazy);
    default: return false;
  }
}
