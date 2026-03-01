import type { Declaration } from "../transformer/types.js";
import { emitMetaDeclaration, hasMeta } from "./meta.js";
import { emitSchemaDeclaration, topoSort } from "./schema.js";

export function generate(declarations: Declaration[]): string {
  const sorted = topoSort(declarations);

  const blocks: string[] = [
    `import { z } from "zod";`,
    `import type { XmlMeta } from "xsd2zod";`,
    "",
  ];

  // Emit target namespace constant if any declaration carries one
  const namespace = declarations.find((d) => d.namespace !== undefined)?.namespace;
  if (namespace !== undefined) {
    blocks.push(`export const $targetNamespace = ${JSON.stringify(namespace)};`);
    blocks.push("");
  }

  for (const decl of sorted) {
    blocks.push(emitSchemaDeclaration(decl));
    const typeName = decl.jsName.replace(/Schema$/, "");
    blocks.push(`export type ${typeName} = z.infer<typeof ${decl.jsName}>;`);
    if (hasMeta(decl)) {
      const metaDecl = emitMetaDeclaration(decl);
      if (metaDecl) blocks.push(metaDecl);
    }
    blocks.push("");
  }

  return blocks.join("\n").trimEnd() + "\n";
}
