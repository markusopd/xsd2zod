import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { xsd2zod } from "../../src/index.js";

const fixture = (dir: string, file: string) =>
  readFile(join(import.meta.dirname, "../fixtures", dir, file), "utf-8");

const wrap = (body: string) =>
  `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">${body}</xs:schema>`;

describe("full pipeline", () => {
  it("generates z.object for xs:sequence", () => {
    const { code, warnings } = xsd2zod(wrap(`
      <xs:complexType name="Person">
        <xs:sequence>
          <xs:element name="name" type="xs:string"/>
          <xs:element name="age"  type="xs:integer" minOccurs="0"/>
        </xs:sequence>
      </xs:complexType>
    `));
    expect(warnings).toHaveLength(0);
    expect(code).toContain("PersonSchema");
    expect(code).toContain("z.object(");
    expect(code).toContain("name: z.string()");
    expect(code).toContain("age: z.number().int().optional()");
  });

  it("generates XmlMeta with correct compositor and order", () => {
    const { code } = xsd2zod(wrap(`
      <xs:complexType name="Person">
        <xs:sequence>
          <xs:element name="name" type="xs:string"/>
          <xs:element name="age"  type="xs:integer" minOccurs="0"/>
        </xs:sequence>
      </xs:complexType>
    `));
    expect(code).toContain("PersonMeta");
    expect(code).toContain('compositor: "sequence"');
    expect(code).toContain("order: 0");
    expect(code).toContain("order: 1");
  });

  it("generates XmlMeta with kind=attribute for xs:attribute", () => {
    const { code } = xsd2zod(wrap(`
      <xs:complexType name="T">
        <xs:sequence>
          <xs:element name="val" type="xs:string"/>
        </xs:sequence>
        <xs:attribute name="lang" type="xs:string"/>
      </xs:complexType>
    `));
    expect(code).toContain('kind: "attribute"');
    expect(code).toContain('xmlName: "lang"');
  });

  it("preserves original XML name in metadata for camelCased field", () => {
    const { code } = xsd2zod(wrap(`
      <xs:complexType name="T">
        <xs:sequence>
          <xs:element name="house-number" type="xs:integer"/>
        </xs:sequence>
      </xs:complexType>
    `));
    expect(code).toContain("houseNumber");
    expect(code).toContain('"house-number"');
  });

  it("generates z.enum for xs:enumeration", () => {
    const { code } = xsd2zod(wrap(`
      <xs:simpleType name="Color">
        <xs:restriction base="xs:string">
          <xs:enumeration value="red"/>
          <xs:enumeration value="green"/>
          <xs:enumeration value="blue"/>
        </xs:restriction>
      </xs:simpleType>
    `));
    expect(code).toContain('z.enum(["red", "green", "blue"])');
  });

  it("generates z.array for maxOccurs=unbounded", () => {
    const { code } = xsd2zod(wrap(`
      <xs:complexType name="T">
        <xs:sequence>
          <xs:element name="item" type="xs:string" maxOccurs="unbounded"/>
        </xs:sequence>
      </xs:complexType>
    `));
    expect(code).toContain("z.array(z.string())");
  });

  it("generates z.bigint() for xs:long by default", () => {
    const { code } = xsd2zod(wrap(`<xs:element name="x" type="xs:long"/>`));
    expect(code).toContain("z.bigint()");
  });

  it("generates z.number().int() for xs:long with longStrategy=number", () => {
    const { code } = xsd2zod(wrap(`<xs:element name="x" type="xs:long"/>`), {
      longStrategy: "number",
    });
    expect(code).toContain("z.number().int()");
  });

  it("generates $text field for xs:simpleContent", () => {
    const { code } = xsd2zod(wrap(`
      <xs:complexType name="Quantity">
        <xs:simpleContent>
          <xs:extension base="xs:decimal">
            <xs:attribute name="unit" type="xs:string" use="required"/>
          </xs:extension>
        </xs:simpleContent>
      </xs:complexType>
    `));
    expect(code).toContain("$text");
    expect(code).toContain('kind: "text"');
    expect(code).toContain('compositor: "none"');
  });

  it("generates choiceGroups for xs:choice", () => {
    const { code } = xsd2zod(wrap(`
      <xs:complexType name="T">
        <xs:sequence>
          <xs:choice>
            <xs:element name="a" type="xs:string"/>
            <xs:element name="b" type="xs:integer"/>
          </xs:choice>
        </xs:sequence>
      </xs:complexType>
    `));
    expect(code).toContain("choiceGroups");
    expect(code).toContain('"a"');
    expect(code).toContain('"b"');
  });

  it("emits UNRESOLVED_TYPE_REF warning for unknown type", () => {
    const { warnings } = xsd2zod(wrap(`<xs:element name="x" type="ns:Ghost"/>`));
    expect(warnings.some((w) => w.code === "UNRESOLVED_TYPE_REF")).toBe(true);
  });

  it("throws in strict mode on warning", () => {
    expect(() =>
      xsd2zod(wrap(`<xs:element name="x" type="ns:Ghost"/>`), { strict: true })
    ).toThrow();
  });

  it("generates xs:all with compositor=all", () => {
    const { code } = xsd2zod(wrap(`
      <xs:complexType name="T">
        <xs:all>
          <xs:element name="a" type="xs:string"/>
          <xs:element name="b" type="xs:string" minOccurs="0"/>
        </xs:all>
      </xs:complexType>
    `));
    expect(code).toContain('compositor: "all"');
    // required field should NOT be optional
    expect(code).toContain("a: z.string(),");
    // optional field should be optional
    expect(code).toContain("b: z.string().optional()");
  });

  describe("xs:choice superRefine", () => {
    it("emits superRefine for choice groups", () => {
      const { code } = xsd2zod(wrap(`
        <xs:complexType name="T">
          <xs:sequence>
            <xs:choice>
              <xs:element name="a" type="xs:string"/>
              <xs:element name="b" type="xs:integer"/>
            </xs:choice>
          </xs:sequence>
        </xs:complexType>
      `));
      expect(code).toContain("superRefine");
      expect(code).toContain("ZodIssueCode.custom");
      expect(code).toContain("Exactly one of");
    });
  });

  describe("xs:extension metadata", () => {
    it("emits extends in XmlMeta for extended type", () => {
      const { code } = xsd2zod(wrap(`
        <xs:complexType name="Animal">
          <xs:sequence>
            <xs:element name="name" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
        <xs:complexType name="Dog">
          <xs:complexContent>
            <xs:extension base="Animal">
              <xs:sequence>
                <xs:element name="breed" type="xs:string"/>
              </xs:sequence>
            </xs:extension>
          </xs:complexContent>
        </xs:complexType>
      `));
      expect(code).toContain("AnimalSchema.extend(");
      expect(code).toContain('extends: "Animal"');
    });
  });

  describe("fixture files", () => {
    it("processes sequence.xsd without warnings", async () => {
      const xsd = await fixture("complex-types", "sequence.xsd");
      const { code, warnings } = xsd2zod(xsd);
      expect(warnings).toHaveLength(0);
      expect(code).toContain("AddressSchema");
      expect(code).toContain("AddressMeta");
    });

    it("processes colors.xsd (enumeration) without warnings", async () => {
      const xsd = await fixture("enumeration", "colors.xsd");
      const { code, warnings } = xsd2zod(xsd);
      expect(warnings).toHaveLength(0);
      expect(code).toContain('z.enum(["red", "green", "blue"])');
    });

    it("processes quantity.xsd (simpleContent) without warnings", async () => {
      const xsd = await fixture("simple-content", "quantity.xsd");
      const { code, warnings } = xsd2zod(xsd);
      expect(warnings).toHaveLength(0);
      expect(code).toContain("$text");
      expect(code).toContain('compositor: "none"');
    });

    it("processes payment.xsd (choice) without warnings", async () => {
      const xsd = await fixture("choice", "payment.xsd");
      const { code, warnings } = xsd2zod(xsd);
      expect(warnings).toHaveLength(0);
      expect(code).toContain("choiceGroups");
      expect(code).toContain("PaymentSchema");
    });

    it("processes groups.xsd without UNSUPPORTED_CONSTRUCT warnings", async () => {
      const xsd = await readFile(
        join(import.meta.dirname, "../fixtures/groups.xsd"),
        "utf-8"
      );
      const { code, warnings } = xsd2zod(xsd);
      expect(warnings.filter((w) => w.code === "UNSUPPORTED_CONSTRUCT")).toHaveLength(0);
      expect(code).toContain("PersonSchema");
      expect(code).toContain("firstName");
      expect(code).toContain("lastName");
      expect(code).toContain("email");
      // attributeGroup fields
      expect(code).toContain("id:");
      expect(code).toContain("lang:");
    });

    it("processes extension.xsd with extends in meta", async () => {
      const xsd = await readFile(
        join(import.meta.dirname, "../fixtures/extension.xsd"),
        "utf-8"
      );
      const { code, warnings } = xsd2zod(xsd);
      expect(warnings).toHaveLength(0);
      expect(code).toContain("AnimalSchema.extend(");
      expect(code).toContain("DogSchema");
      expect(code).toContain('extends: "Animal"');
      expect(code).toContain('extends: "Dog"');
    });

    it("processes union-choice.xsd emitting z.union", async () => {
      const xsd = await readFile(
        join(import.meta.dirname, "../fixtures/union-choice.xsd"),
        "utf-8"
      );
      const { code, warnings } = xsd2zod(xsd);
      expect(warnings.filter((w) => w.code === "UNSUPPORTED_CONSTRUCT")).toHaveLength(0);
      // Top-level choice → z.union
      expect(code).toContain("z.union([");
      expect(code).toContain("PaymentSchema");
      // Meta object still emitted
      expect(code).toContain("PaymentMeta");
      expect(code).toContain('compositor: "choice"');
    });

    it("processes any.xsd emitting $any and $anyAttr fields", async () => {
      const xsd = await readFile(
        join(import.meta.dirname, "../fixtures/any.xsd"),
        "utf-8"
      );
      const { code, warnings } = xsd2zod(xsd);
      expect(warnings.filter((w) => w.code === "UNSUPPORTED_CONSTRUCT")).toHaveLength(0);
      expect(code).toContain("$any");
      expect(code).toContain("z.unknown()");
      expect(code).toContain("$anyAttr");
      expect(code).toContain("z.record(z.string(), z.unknown())");
    });

    it("processes restriction.xsd emitting standalone object for xs:restriction", async () => {
      const xsd = await readFile(
        join(import.meta.dirname, "../fixtures/restriction.xsd"),
        "utf-8"
      );
      const { code } = xsd2zod(xsd);
      expect(code).toContain("DomesticAddressSchema");
      // Should NOT extend AddressSchema
      expect(code).not.toContain("AddressSchema.extend(");
      // Should contain only the restriction's own fields
      expect(code).toContain("street");
      expect(code).toContain("city");
    });
  });

  describe("xs:sequence inside xs:choice (inline superRefine)", () => {
    it("flattens sequence branches as optional choice members", () => {
      const { code, warnings } = xsd2zod(wrap(`
        <xs:complexType name="Event">
          <xs:sequence>
            <xs:choice>
              <xs:sequence>
                <xs:element name="startDate" type="xs:string"/>
                <xs:element name="endDate"   type="xs:string"/>
              </xs:sequence>
              <xs:element name="singleDay" type="xs:string"/>
            </xs:choice>
          </xs:sequence>
        </xs:complexType>
      `));
      expect(warnings.filter((w) => w.code === "UNSUPPORTED_CONSTRUCT")).toHaveLength(0);
      expect(code).toContain("startDate");
      expect(code).toContain("endDate");
      expect(code).toContain("singleDay");
      expect(code).toContain("superRefine");
    });
  });

  describe("xs:group inside xs:choice", () => {
    it("inlines group members as choice branches without UNSUPPORTED_CONSTRUCT", () => {
      const { code, warnings } = xsd2zod(wrap(`
        <xs:group name="NameGroup">
          <xs:sequence>
            <xs:element name="firstName" type="xs:string"/>
            <xs:element name="lastName"  type="xs:string"/>
          </xs:sequence>
        </xs:group>
        <xs:complexType name="T">
          <xs:sequence>
            <xs:choice>
              <xs:group ref="NameGroup"/>
              <xs:element name="alias" type="xs:string"/>
            </xs:choice>
          </xs:sequence>
        </xs:complexType>
      `));
      expect(warnings.filter((w) => w.code === "UNSUPPORTED_CONSTRUCT")).toHaveLength(0);
      expect(code).toContain("firstName");
      expect(code).toContain("lastName");
      expect(code).toContain("alias");
    });
  });
});
