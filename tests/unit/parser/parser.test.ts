import { describe, it, expect } from "vitest";
import { parseXsd } from "../../../src/parser/index.js";

const wrap = (body: string) =>
  `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">${body}</xs:schema>`;

describe("parseXsd", () => {
  it("returns empty schema for empty schema element", () => {
    const result = parseXsd(wrap(""));
    expect(result.elements).toEqual([]);
    expect(result.complexTypes).toEqual([]);
    expect(result.simpleTypes).toEqual([]);
  });

  it("parses targetNamespace", () => {
    const result = parseXsd(
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="http://example.com"></xs:schema>`
    );
    expect(result.targetNamespace).toBe("http://example.com");
  });

  it("collects namespace prefix mappings", () => {
    const result = parseXsd(wrap(""));
    expect(result.namespaces["xs"]).toBe("http://www.w3.org/2001/XMLSchema");
  });

  describe("xs:element", () => {
    it("parses a simple top-level element with type reference", () => {
      const result = parseXsd(wrap(`<xs:element name="name" type="xs:string"/>`));
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0]!.name).toBe("name");
      expect(result.elements[0]!.type).toBe("xs:string");
      expect(result.elements[0]!.minOccurs).toBe(1);
      expect(result.elements[0]!.maxOccurs).toBe(1);
    });

    it("parses minOccurs and maxOccurs", () => {
      const result = parseXsd(
        wrap(`<xs:element name="tags" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>`)
      );
      expect(result.elements[0]!.minOccurs).toBe(0);
      expect(result.elements[0]!.maxOccurs).toBe("unbounded");
    });

    it("parses nillable", () => {
      const result = parseXsd(wrap(`<xs:element name="x" type="xs:string" nillable="true"/>`));
      expect(result.elements[0]!.nillable).toBe(true);
    });

    it("parses default and fixed", () => {
      const result = parseXsd(
        wrap(`<xs:element name="x" type="xs:string" default="hello" fixed="world"/>`)
      );
      expect(result.elements[0]!.default).toBe("hello");
      expect(result.elements[0]!.fixed).toBe("world");
    });
  });

  describe("xs:complexType", () => {
    it("parses a named complexType with sequence", () => {
      const result = parseXsd(wrap(`
        <xs:complexType name="Person">
          <xs:sequence>
            <xs:element name="name" type="xs:string"/>
            <xs:element name="age"  type="xs:integer" minOccurs="0"/>
          </xs:sequence>
        </xs:complexType>
      `));
      expect(result.complexTypes).toHaveLength(1);
      const ct = result.complexTypes[0]!;
      expect(ct.name).toBe("Person");
      expect(ct.compositor).toBe("sequence");
      expect(ct.children).toHaveLength(2);
    });

    it("parses xs:attribute", () => {
      const result = parseXsd(wrap(`
        <xs:complexType name="T">
          <xs:sequence/>
          <xs:attribute name="lang" type="xs:string" use="required"/>
        </xs:complexType>
      `));
      const ct = result.complexTypes[0]!;
      expect(ct.attributes).toHaveLength(1);
      expect(ct.attributes[0]!.name).toBe("lang");
      expect(ct.attributes[0]!.use).toBe("required");
    });

    it("parses xs:all compositor", () => {
      const result = parseXsd(wrap(`
        <xs:complexType name="T">
          <xs:all>
            <xs:element name="a" type="xs:string"/>
          </xs:all>
        </xs:complexType>
      `));
      expect(result.complexTypes[0]!.compositor).toBe("all");
    });

    it("parses abstract flag", () => {
      const result = parseXsd(wrap(`
        <xs:complexType name="T" abstract="true">
          <xs:sequence/>
        </xs:complexType>
      `));
      expect(result.complexTypes[0]!.abstract).toBe(true);
    });
  });

  describe("xs:simpleType", () => {
    it("parses enumeration restriction", () => {
      const result = parseXsd(wrap(`
        <xs:simpleType name="Color">
          <xs:restriction base="xs:string">
            <xs:enumeration value="red"/>
            <xs:enumeration value="green"/>
          </xs:restriction>
        </xs:simpleType>
      `));
      expect(result.simpleTypes).toHaveLength(1);
      const st = result.simpleTypes[0]!;
      expect(st.name).toBe("Color");
      expect(st.restriction?.base).toBe("xs:string");
      expect(st.restriction?.enumeration).toEqual(["red", "green"]);
    });

    it("parses list type", () => {
      const result = parseXsd(wrap(`
        <xs:simpleType name="Tokens">
          <xs:list itemType="xs:string"/>
        </xs:simpleType>
      `));
      expect(result.simpleTypes[0]!.list?.itemType).toBe("xs:string");
    });
  });

  describe("xs:choice", () => {
    it("parses choice inside sequence", () => {
      const result = parseXsd(wrap(`
        <xs:complexType name="T">
          <xs:sequence>
            <xs:element name="a" type="xs:string"/>
            <xs:choice>
              <xs:element name="b" type="xs:string"/>
              <xs:element name="c" type="xs:integer"/>
            </xs:choice>
          </xs:sequence>
        </xs:complexType>
      `));
      const children = result.complexTypes[0]!.children;
      expect(children).toHaveLength(2);
      expect("branches" in children[1]!).toBe(true);
    });
  });

  describe("xs:group and xs:attributeGroup", () => {
    it("parses a top-level xs:group with sequence children", () => {
      const result = parseXsd(wrap(`
        <xs:group name="NameGroup">
          <xs:sequence>
            <xs:element name="first" type="xs:string"/>
            <xs:element name="last"  type="xs:string"/>
          </xs:sequence>
        </xs:group>
      `));
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]!.name).toBe("NameGroup");
      expect(result.groups[0]!.compositor).toBe("sequence");
      expect(result.groups[0]!.children).toHaveLength(2);
    });

    it("parses a top-level xs:attributeGroup", () => {
      const result = parseXsd(wrap(`
        <xs:attributeGroup name="CommonAttrs">
          <xs:attribute name="id"   type="xs:string" use="required"/>
          <xs:attribute name="lang" type="xs:string"/>
        </xs:attributeGroup>
      `));
      expect(result.attributeGroups).toHaveLength(1);
      expect(result.attributeGroups[0]!.name).toBe("CommonAttrs");
      expect(result.attributeGroups[0]!.attributes).toHaveLength(2);
    });

    it("records attributeGroupRefs on complexType", () => {
      const result = parseXsd(wrap(`
        <xs:attributeGroup name="CommonAttrs">
          <xs:attribute name="id" type="xs:string"/>
        </xs:attributeGroup>
        <xs:complexType name="T">
          <xs:sequence/>
          <xs:attributeGroup ref="CommonAttrs"/>
        </xs:complexType>
      `));
      const ct = result.complexTypes[0]!;
      expect(ct.attributeGroupRefs).toEqual(["CommonAttrs"]);
    });
  });
});
