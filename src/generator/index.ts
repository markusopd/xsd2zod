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

  for (const decl of sorted) {
    blocks.push(emitSchemaDeclaration(decl));
    if (hasMeta(decl.node)) {
      const metaDecl = emitMetaDeclaration(decl);
      if (metaDecl) blocks.push(metaDecl);
    }
    blocks.push("");
  }

  return blocks.join("\n").trimEnd() + "\n";
}
