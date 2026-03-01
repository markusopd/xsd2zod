import type { ZodTypeAny } from "zod";

export interface XmlFieldMeta {
  /** How this field maps to an XML node */
  kind: "element" | "attribute" | "text";

  /** Original XML name before camelCase conversion */
  xmlName: string;

  /** Target namespace URI (element fields only) */
  namespace?: string;

  /**
   * Zero-based position within xs:sequence.
   * Absent for xs:all (order is unconstrained).
   * Fields in the same xs:choice share the same order value.
   */
  order?: number;

  /**
   * ID of the xs:choice group this field belongs to.
   * Exactly one field per group may appear in a valid document.
   * Matches a key in XmlTypeMeta.choiceGroups.
   */
  choiceGroup?: string;

  /**
   * For array fields: if the repeated elements are wrapped in a container
   * element, this is the container's XML name.
   * xmlName is the name of each repeated child.
   */
  wrapperXmlName?: string;

  /** XSD default value; used when the field is absent during serialisation */
  default?: string;

  /** XSD fixed value; must always equal this value */
  fixed?: string;

  /** Whether the element accepts xsi:nil="true" */
  nillable?: boolean;
}

export interface XmlTypeMeta<_T extends ZodTypeAny = ZodTypeAny> {
  /** Original XML element or type name */
  xmlName: string;

  /** Target namespace URI */
  namespace?: string;

  /**
   * "sequence" — children must appear in XmlFieldMeta.order order
   * "all"      — children may appear in any order; each child's minOccurs still applies
   * "choice"   — exactly one child from a choice group must appear
   * "none"     — no child elements (simpleContent: text + attributes only)
   */
  compositor: "sequence" | "all" | "choice" | "none";

  /**
   * Per-field metadata keyed by JS property name.
   * Typed as Record rather than a mapped type so XmlTypeMeta works for
   * non-object roots (unions, lazy types, simple type wrappers).
   */
  fields: Record<string, XmlFieldMeta>;

  /** Maps choice group ID → mutually exclusive JS field names */
  choiceGroups?: Record<string, string[]>;

  /** XML name of the base type when this type extends another (xs:extension) */
  extends?: string;

  /** True when the XSD type is abstract="true" */
  abstract?: boolean;

  /** True when the XSD type allows mixed content (text + child elements) */
  mixed?: boolean;
}

export type XmlMeta<T extends ZodTypeAny = ZodTypeAny> = XmlTypeMeta<T>;

export type WarningCode =
  | "UNSUPPORTED_CONSTRUCT" // construct skipped entirely
  | "PARTIAL_REGEX"         // xs:pattern could not be fully translated to JS regex
  | "PRECISION_LOSS"        // numeric type mapped with longStrategy=number
  | "ABSTRACT_TYPE"         // abstract type emitted as its base type
  | "CIRCULAR_REF"          // z.lazy emitted; explicit type annotation required
  | "UNRESOLVED_TYPE_REF"   // type reference could not be resolved (emits z.unknown())
  | "RESTRICTION_BASE";     // xs:complexContent/xs:restriction base not intersected

export interface Xsd2ZodWarning {
  code: WarningCode;
  message: string;
  /** Dot-separated path into the XSD structure, e.g. "Person.address.street" */
  xsdPath: string;
}

export interface Xsd2ZodResult {
  /** Generated TypeScript source */
  code: string;
  warnings: Xsd2ZodWarning[];
}

export interface Xsd2ZodOptions {
  /** Emit z.coerce.* types for XML string inputs */
  coerce?: boolean;
  /** Zod modifier for absent elements (minOccurs="0") */
  absenceStrategy?: "optional" | "nullable" | "nullish";
  /** How to represent xs:long / xs:unsignedLong */
  longStrategy?: "bigint" | "number" | "string";
  /** How to represent xs:date / xs:dateTime */
  dateStrategy?: "string" | "date";
  /** Throw on the first warning instead of collecting */
  strict?: boolean;
}
