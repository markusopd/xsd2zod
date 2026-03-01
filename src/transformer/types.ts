import type { XmlFieldMeta } from "../meta-types.js";

export type SchemaNode =
  | PrimitiveNode
  | ObjectNode
  | ArrayNode
  | UnionNode
  | EnumNode
  | RefNode
  | LazyNode
  | UnknownNode;

interface NodeBase {
  optional?: boolean;
  nullable?: boolean;
}

export interface PrimitiveNode extends NodeBase {
  kind: "primitive";
  /** A complete Zod expression string, e.g. "z.string()" or "z.number().int().min(0)" */
  zodExpr: string;
}

export interface ObjectField {
  jsName: string;
  node: SchemaNode;
  meta: XmlFieldMeta;
}

export interface ObjectNode extends NodeBase {
  kind: "object";
  /** Identifier of a named type this object extends (for z.extend()) */
  extends?: string;
  fields: ObjectField[];
  compositor: "sequence" | "all" | "choice" | "none";
  /** Maps choiceGroup ID → list of jsNames that are mutually exclusive */
  choiceGroups: Record<string, string[]>;
  abstract: boolean;
  mixed: boolean;
}

export interface ArrayNode extends NodeBase {
  kind: "array";
  item: SchemaNode;
}

export interface UnionNode extends NodeBase {
  kind: "union";
  members: SchemaNode[];
}

export interface EnumNode extends NodeBase {
  kind: "enum";
  values: string[];
}

/**
 * A direct reference to a named schema identifier, e.g. AddressSchema.
 * Used when a field's type is a named top-level XSD type.
 * Emitted as just the identifier (no z.lazy wrapper).
 */
export interface RefNode extends NodeBase {
  kind: "ref";
  ref: string;
}

export interface LazyNode extends NodeBase {
  kind: "lazy";
  /** JS identifier of the schema being referenced */
  ref: string;
  /** Inferred TypeScript type for the explicit ZodType annotation */
  tsType: string;
}

export interface UnknownNode extends NodeBase {
  kind: "unknown";
}

/** Top-level named declaration emitted as a const in the output */
export interface Declaration {
  /** JS identifier, e.g. "PersonSchema" */
  jsName: string;
  /** Original XSD name, e.g. "Person" */
  xmlName: string;
  node: SchemaNode;
  /**
   * For top-level choice types emitted as z.union: an ObjectNode used
   * exclusively for XmlMeta emission (all branches flattened as optional fields).
   */
  metaNode?: ObjectNode;
  /** Target namespace URI from xs:schema/@targetNamespace */
  namespace?: string;
}
