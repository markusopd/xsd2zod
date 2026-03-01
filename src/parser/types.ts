export interface XsdAttribute {
  name: string;
  type: string;
  use: "required" | "optional" | "prohibited";
  default?: string;
  fixed?: string;
}

export interface XsdElement {
  name: string;
  /** Reference to a named type (built-in or user-defined) */
  type?: string;
  minOccurs: number;
  maxOccurs: number | "unbounded";
  /** Inline complex or simple type definition */
  inlineType?: XsdComplexType | XsdSimpleType;
  nillable: boolean;
  default?: string;
  fixed?: string;
}

export interface XsdRestriction {
  base: string;
  enumeration?: string[];
  minLength?: number;
  maxLength?: number;
  length?: number;
  pattern?: string;
  minInclusive?: string;
  maxInclusive?: string;
  minExclusive?: string;
  maxExclusive?: string;
  totalDigits?: number;
  fractionDigits?: number;
}

export interface XsdSimpleType {
  kind: "simple";
  name?: string;
  restriction?: XsdRestriction;
  list?: { itemType: string };
  union?: { memberTypes: string[] };
}

export interface XsdChoice {
  minOccurs: number;
  maxOccurs: number | "unbounded";
  branches: Array<XsdElement | XsdChoice | XsdGroup | XsdSequenceBranch>;
}

export interface XsdGroup {
  kind: "group";
  ref: string;
}

/** A nested xs:sequence inside an xs:choice branch */
export interface XsdSequenceBranch {
  kind: "sequence";
  children: XsdCompositorChild[];
}

export type XsdCompositorChild = XsdElement | XsdChoice | XsdGroup | XsdSequenceBranch;

export interface XsdComplexType {
  kind: "complex";
  name?: string;
  compositor: "sequence" | "all" | "choice" | "none";
  children: XsdCompositorChild[];
  attributes: XsdAttribute[];
  /** xs:attributeGroup references at the complexType level */
  attributeGroupRefs?: string[];
  /** For xs:extension */
  extension?: {
    base: string;
    children: XsdCompositorChild[];
    attributes: XsdAttribute[];
    attributeGroupRefs?: string[];
    compositor: "sequence" | "all" | "choice" | "none";
  };
  /** For xs:simpleContent with xs:extension */
  simpleContent?: {
    base: string;
    attributes: XsdAttribute[];
  };
  /** For xs:complexContent/xs:restriction */
  restriction?: {
    base: string;
    children: XsdCompositorChild[];
    attributes: XsdAttribute[];
    attributeGroupRefs?: string[];
    compositor: "sequence" | "all" | "choice" | "none";
  };
  /** True when the compositor children contain xs:any */
  hasAny?: boolean;
  /** True when xs:anyAttribute is present */
  hasAnyAttribute?: boolean;
  mixed: boolean;
  abstract: boolean;
}

/** A top-level xs:group definition (reusable element group) */
export interface XsdNamedGroup {
  name: string;
  compositor: "sequence" | "all" | "choice" | "none";
  children: XsdCompositorChild[];
}

/** A top-level xs:attributeGroup definition */
export interface XsdAttributeGroup {
  name: string;
  attributes: XsdAttribute[];
  /** Nested xs:attributeGroup references */
  attributeGroupRefs: string[];
}

export interface XsdSchema {
  targetNamespace?: string;
  /** Map of namespace prefix → URI extracted from xmlns:* attributes */
  namespaces: Record<string, string>;
  /** Top-level xs:element declarations */
  elements: XsdElement[];
  /** Top-level xs:complexType declarations */
  complexTypes: XsdComplexType[];
  /** Top-level xs:simpleType declarations */
  simpleTypes: XsdSimpleType[];
  /** Top-level xs:group definitions */
  groups: XsdNamedGroup[];
  /** Top-level xs:attributeGroup definitions */
  attributeGroups: XsdAttributeGroup[];
}
