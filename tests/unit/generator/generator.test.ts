import { describe, it, expect } from "vitest";
import { emitNodeExpr } from "../../../src/generator/schema.js";
import { emitMetaDeclaration } from "../../../src/generator/meta.js";
import type { Declaration } from "../../../src/transformer/types.js";

describe("emitNodeExpr", () => {
  it("emits a primitive node", () => {
    expect(emitNodeExpr({ kind: "primitive", zodExpr: "z.string()" })).toBe("z.string()");
  });

  it("emits an optional primitive", () => {
    expect(emitNodeExpr({ kind: "primitive", zodExpr: "z.string()", optional: true }))
      .toBe("z.string().optional()");
  });

  it("emits a nullable primitive", () => {
    expect(emitNodeExpr({ kind: "primitive", zodExpr: "z.number()", nullable: true }))
      .toBe("z.number().nullable()");
  });

  it("emits nullable before optional", () => {
    expect(emitNodeExpr({ kind: "primitive", zodExpr: "z.string()", nullable: true, optional: true }))
      .toBe("z.string().nullable().optional()");
  });

  it("emits unknown node", () => {
    expect(emitNodeExpr({ kind: "unknown" })).toBe("z.unknown()");
  });

  it("emits enum node with multiple values", () => {
    expect(emitNodeExpr({ kind: "enum", values: ["red", "green", "blue"] }))
      .toBe('z.enum(["red", "green", "blue"])');
  });

  it("emits enum with single value as literal", () => {
    expect(emitNodeExpr({ kind: "enum", values: ["only"] }))
      .toBe('z.literal("only")');
  });

  it("emits array node", () => {
    expect(emitNodeExpr({ kind: "array", item: { kind: "primitive", zodExpr: "z.string()" } }))
      .toBe("z.array(z.string())");
  });

  it("emits optional array", () => {
    expect(emitNodeExpr({
      kind: "array",
      item: { kind: "primitive", zodExpr: "z.string()" },
      optional: true,
    })).toBe("z.array(z.string()).optional()");
  });

  it("emits lazy node", () => {
    expect(emitNodeExpr({ kind: "lazy", ref: "PersonSchema", tsType: "Person" }))
      .toBe("z.lazy(() => PersonSchema)");
  });

  it("emits object node", () => {
    const expr = emitNodeExpr({
      kind: "object",
      fields: [
        { jsName: "name", node: { kind: "primitive", zodExpr: "z.string()" }, meta: { kind: "element", xmlName: "name" } },
        { jsName: "age", node: { kind: "primitive", zodExpr: "z.number().int()", optional: true }, meta: { kind: "element", xmlName: "age" } },
      ],
      compositor: "sequence",
      choiceGroups: {},
      abstract: false,
      mixed: false,
    });
    expect(expr).toContain("z.object(");
    expect(expr).toContain("name: z.string()");
    expect(expr).toContain("age: z.number().int().optional()");
  });
});

describe("emitMetaDeclaration", () => {
  it("emits XmlMeta for an object declaration", () => {
    const decl: Declaration = {
      jsName: "AddressSchema",
      xmlName: "Address",
      node: {
        kind: "object",
        fields: [
          {
            jsName: "street",
            node: { kind: "primitive", zodExpr: "z.string()" },
            meta: { kind: "element", xmlName: "street", order: 0 },
          },
          {
            jsName: "countryCode",
            node: { kind: "primitive", zodExpr: "z.string()" },
            meta: { kind: "attribute", xmlName: "country-code" },
          },
        ],
        compositor: "sequence",
        choiceGroups: {},
        abstract: false,
        mixed: false,
      },
    };
    const result = emitMetaDeclaration(decl);
    expect(result).not.toBeNull();
    expect(result).toContain("AddressMeta");
    expect(result).toContain('xmlName: "Address"');
    expect(result).toContain('compositor: "sequence"');
    expect(result).toContain('kind: "element"');
    expect(result).toContain('xmlName: "street"');
    expect(result).toContain("order: 0");
    expect(result).toContain('kind: "attribute"');
    expect(result).toContain('xmlName: "country-code"');
  });

  it("returns null for non-object declarations", () => {
    const decl: Declaration = {
      jsName: "ColorSchema",
      xmlName: "Color",
      node: { kind: "enum", values: ["red"] },
    };
    expect(emitMetaDeclaration(decl)).toBeNull();
  });

  it("emits choiceGroups when present", () => {
    const decl: Declaration = {
      jsName: "PaymentSchema",
      xmlName: "Payment",
      node: {
        kind: "object",
        fields: [
          {
            jsName: "creditCard",
            node: { kind: "unknown", optional: true },
            meta: { kind: "element", xmlName: "credit-card", order: 0, choiceGroup: "choice_0" },
          },
          {
            jsName: "bankTransfer",
            node: { kind: "unknown", optional: true },
            meta: { kind: "element", xmlName: "bank-transfer", order: 0, choiceGroup: "choice_0" },
          },
        ],
        compositor: "sequence",
        choiceGroups: { choice_0: ["creditCard", "bankTransfer"] },
        abstract: false,
        mixed: false,
      },
    };
    const result = emitMetaDeclaration(decl);
    expect(result).toContain("choiceGroups");
    expect(result).toContain("choice_0");
    expect(result).toContain('"creditCard"');
    expect(result).toContain('"bankTransfer"');
  });
});
