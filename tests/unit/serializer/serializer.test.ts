import { describe, it, expect } from "vitest";
import { objectToXml } from "../../../src/serializer/index.js";
import type { XmlTypeMeta } from "../../../src/meta-types.js";

// ---------------------------------------------------------------------------
// Minimal meta helpers
// ---------------------------------------------------------------------------

function seqMeta(xmlName: string, fields: XmlTypeMeta["fields"]): XmlTypeMeta {
  return { xmlName, compositor: "sequence", fields };
}

// ---------------------------------------------------------------------------
// Basic element serialization
// ---------------------------------------------------------------------------

describe("objectToXml", () => {
  describe("primitive elements", () => {
    it("serializes a flat sequence of string elements", () => {
      const meta = seqMeta("Person", {
        name: { kind: "element", xmlName: "name", order: 0 },
        age:  { kind: "element", xmlName: "age",  order: 1 },
      });
      const xml = objectToXml({ name: "Alice", age: 30 }, meta);
      expect(xml).toContain("<Person>");
      expect(xml).toContain("<name>Alice</name>");
      expect(xml).toContain("<age>30</age>");
      expect(xml).toContain("</Person>");
    });

    it("respects order when compositor is sequence", () => {
      const meta = seqMeta("T", {
        b: { kind: "element", xmlName: "b", order: 1 },
        a: { kind: "element", xmlName: "a", order: 0 },
      });
      const xml = objectToXml({ a: "1", b: "2" }, meta);
      expect(xml.indexOf("<a>")).toBeLessThan(xml.indexOf("<b>"));
    });

    it("overrides root element name via rootElement option", () => {
      const meta = seqMeta("Person", {
        name: { kind: "element", xmlName: "name", order: 0 },
      });
      const xml = objectToXml({ name: "Bob" }, meta, { rootElement: "Employee" });
      expect(xml).toContain("<Employee>");
      expect(xml).toContain("</Employee>");
      expect(xml).not.toContain("<Person>");
    });

    it("emits self-closing tag for empty object", () => {
      const meta = seqMeta("Empty", {});
      const xml = objectToXml({}, meta);
      expect(xml).toContain("<Empty/>");
    });

    it("skips undefined optional fields", () => {
      const meta = seqMeta("T", {
        name:     { kind: "element", xmlName: "name",     order: 0 },
        nickname: { kind: "element", xmlName: "nickname", order: 1, optional: true },
      });
      const xml = objectToXml({ name: "Alice" }, meta);
      expect(xml).toContain("<name>Alice</name>");
      expect(xml).not.toContain("nickname");
    });
  });

  describe("attributes", () => {
    it("serializes attribute fields on the root element tag", () => {
      const meta = seqMeta("Item", {
        id:    { kind: "attribute", xmlName: "id" },
        value: { kind: "element",   xmlName: "value", order: 0 },
      });
      const xml = objectToXml({ id: "42", value: "hello" }, meta);
      expect(xml).toContain('id="42"');
      expect(xml).toContain("<value>hello</value>");
    });

    it("skips undefined attribute values", () => {
      const meta = seqMeta("T", {
        lang: { kind: "attribute", xmlName: "lang", optional: true },
        name: { kind: "element",   xmlName: "name", order: 0 },
      });
      const xml = objectToXml({ name: "x" }, meta);
      expect(xml).not.toContain("lang");
    });
  });

  describe("simpleContent ($text)", () => {
    it("serializes text content alongside attributes", () => {
      const meta: XmlTypeMeta = {
        xmlName: "Quantity",
        compositor: "none",
        fields: {
          $text: { kind: "text",      xmlName: "#text" },
          unit:  { kind: "attribute", xmlName: "unit" },
        },
      };
      const xml = objectToXml({ $text: "42.5", unit: "kg" }, meta);
      expect(xml).toContain('unit="kg"');
      expect(xml).toContain(">42.5<");
    });
  });

  describe("arrays (isArray: true)", () => {
    it("repeats the element for each array item", () => {
      const meta = seqMeta("List", {
        item: { kind: "element", xmlName: "item", order: 0, isArray: true },
      });
      const xml = objectToXml({ item: ["a", "b", "c"] }, meta);
      expect(xml).toContain("<item>a</item>");
      expect(xml).toContain("<item>b</item>");
      expect(xml).toContain("<item>c</item>");
    });
  });

  describe("nested complex types (nestedMeta)", () => {
    it("recurses into nestedMeta for object fields", () => {
      const addressMeta = seqMeta("Address", {
        street: { kind: "element", xmlName: "street", order: 0 },
        city:   { kind: "element", xmlName: "city",   order: 1 },
      });
      const personMeta = seqMeta("Person", {
        name:    { kind: "element", xmlName: "name",    order: 0 },
        address: { kind: "element", xmlName: "address", order: 1, nestedMeta: addressMeta },
      });
      const xml = objectToXml(
        { name: "Alice", address: { street: "Main St", city: "Oslo" } },
        personMeta,
        { indent: "  " }
      );
      expect(xml).toContain("<Person>");
      expect(xml).toContain("<name>Alice</name>");
      expect(xml).toContain("<address>");
      expect(xml).toContain("<street>Main St</street>");
      expect(xml).toContain("<city>Oslo</city>");
      expect(xml).toContain("</address>");
      expect(xml).toContain("</Person>");
    });

    it("serializes arrays of nested objects", () => {
      const itemMeta = seqMeta("Item", {
        id: { kind: "element", xmlName: "id", order: 0 },
      });
      const listMeta = seqMeta("List", {
        item: { kind: "element", xmlName: "item", order: 0, isArray: true, nestedMeta: itemMeta },
      });
      const xml = objectToXml(
        { item: [{ id: "1" }, { id: "2" }] },
        listMeta
      );
      expect(xml.match(/<item>/g)).toHaveLength(2);
      expect(xml).toContain("<id>1</id>");
      expect(xml).toContain("<id>2</id>");
    });
  });

  describe("indentation", () => {
    it("applies indent when option is set", () => {
      const meta = seqMeta("Root", {
        child: { kind: "element", xmlName: "child", order: 0 },
      });
      const xml = objectToXml({ child: "x" }, meta, { indent: "  " });
      expect(xml).toContain("\n  <child>x</child>");
    });

    it("produces compact output without indent option", () => {
      const meta = seqMeta("Root", {
        child: { kind: "element", xmlName: "child", order: 0 },
      });
      const xml = objectToXml({ child: "x" }, meta);
      expect(xml).not.toContain("\n  ");
    });
  });

  describe("namespace", () => {
    it("adds xmlns to the root element", () => {
      const meta = seqMeta("Root", {
        val: { kind: "element", xmlName: "val", order: 0 },
      });
      const xml = objectToXml({ val: "1" }, meta, {
        namespace: "http://example.com/ns",
      });
      expect(xml).toContain('xmlns="http://example.com/ns"');
    });
  });

  describe("XML escaping", () => {
    it("escapes special characters in text content", () => {
      const meta = seqMeta("T", {
        note: { kind: "element", xmlName: "note", order: 0 },
      });
      const xml = objectToXml({ note: "a < b & c > d" }, meta);
      expect(xml).toContain("a &lt; b &amp; c &gt; d");
    });

    it("escapes special characters in attribute values", () => {
      const meta = seqMeta("T", {
        label: { kind: "attribute", xmlName: "label" },
      });
      const xml = objectToXml({ label: 'say "hi"' }, meta);
      expect(xml).toContain('label="say &quot;hi&quot;"');
    });
  });
});
