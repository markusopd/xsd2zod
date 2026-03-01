# xsd2zod

Convert XSD (XML Schema Definition) files into [Zod](https://zod.dev) schemas.

## Overview

`xsd2zod` parses `.xsd` files and generates TypeScript source code containing
Zod schema definitions. It can be used as a CLI tool or imported as a library.

```ts
import { xsd2zod } from "xsd2zod";

const code = xsd2zod(`
  <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
    <xs:element name="person">
      <xs:complexType>
        <xs:sequence>
          <xs:element name="name"       type="xs:string"/>
          <xs:element name="age"        type="xs:integer" minOccurs="0"/>
          <xs:element name="hobby"      type="xs:string"  maxOccurs="unbounded" minOccurs="0"/>
        </xs:sequence>
        <xs:attribute name="lang" type="xs:string"/>
      </xs:complexType>
    </xs:element>
  </xs:schema>
`);
```

Generated output:

```ts
import { z } from "zod";
import type { XmlMeta } from "xsd2zod";

export const PersonSchema = z.object({
  name:  z.string(),
  age:   z.number().int().optional(),
  hobby: z.array(z.string()).optional(),
  lang:  z.string().optional(),
});

export const PersonMeta: XmlMeta<typeof PersonSchema> = {
  xmlName:    "person",
  compositor: "sequence",
  fields: {
    name:  { kind: "element",   xmlName: "name",  order: 0 },
    age:   { kind: "element",   xmlName: "age",   order: 1 },
    hobby: { kind: "element",   xmlName: "hobby", order: 2 },
    lang:  { kind: "attribute", xmlName: "lang" },
  },
};
```

```sh
npx xsd2zod input.xsd -o schemas.ts
```

---

## Architecture

The conversion pipeline has three stages:

```
XSD string/file
      │
      ▼
┌─────────────┐
│   Parser    │  fast-xml-parser → raw XML object tree
└─────────────┘
      │
      ▼
┌─────────────┐
│ Transformer │  XSD AST → internal SchemaNode IR
└─────────────┘
      │
      ▼
┌─────────────┐
│  Generator  │  SchemaNode IR → TypeScript Zod source code
└─────────────┘
      │
      ▼
TypeScript source string
```

### Parser
Uses `fast-xml-parser` to parse the raw XSD XML into a JavaScript object tree,
then a typed traversal layer walks the tree and extracts XSD declarations into a
typed internal `XsdSchema` structure.

### Transformer
Walks the `XsdSchema` and produces a tree of `SchemaNode` objects — a
representation that maps directly onto Zod concepts (objects, unions, arrays,
primitives, restrictions, etc.). This is the most logic-heavy stage and handles
type resolution, inheritance, and cardinality.

### Generator
Walks the `SchemaNode` tree and emits a TypeScript source string. Variable
names are camelCase-ified from the XSD element/type names. Declarations are
topologically sorted to avoid forward references. Circular references are
detected via DFS, emitted as `z.lazy(() => ...)`, and given explicit
`z.ZodType<T>` annotations because TypeScript cannot infer through cycles.

---

## API

### Programmatic

```ts
import { xsd2zod, xsd2zodFile } from "xsd2zod";

// Accepts XSD as a string, returns generated source + any warnings
const { code, warnings } = xsd2zod(xsdString, options?);

// File-based helper (reads from disk, resolves xs:import/xs:include)
const { code, warnings } = await xsd2zodFile("./schema.xsd", options?);

// Throw on first warning instead of collecting
const { code } = xsd2zod(xsdString, { strict: true });
```

**Options**

| Option | Type | Default | Description |
|---|---|---|---|
| `coerce` | `boolean` | `false` | Emit `z.coerce.*` types for XML string inputs |
| `absenceStrategy` | `"optional" \| "nullable" \| "nullish"` | `"optional"` | Zod modifier for absent elements (`minOccurs="0"`). Distinct from nillability. |
| `dateStrategy` | `"string" \| "date"` | `"string"` | Emit `z.string().date()` or `z.date()` for date types |
| `longStrategy` | `"bigint" \| "number" \| "string"` | `"bigint"` | How to represent `xs:long` / `xs:unsignedLong`, which exceed `Number.MAX_SAFE_INTEGER` |
| `exportStyle` | `"named" \| "const"` | `"named"` | Export style for generated schemas |

> **Absence vs nillability** — `absenceStrategy` controls what Zod modifier is
> emitted for elements that may be *absent* from the XML document (`minOccurs="0"`).
> It is separate from `nillable="true"`, which means the element is *present* but
> carries `xsi:nil="true"` to signal a null value. Nillable elements always get an
> additional `.nullable()` layer on top of whatever `absenceStrategy` produces.

### CLI

```sh
xsd2zod [options] <input.xsd>

Options:
  -o, --output <file>    Output file (default: stdout)
  --coerce               Emit z.coerce.* types
  --absence-strategy     optional | nullable | nullish  (default: optional)
  --date-strategy        string | date  (default: string)
  --long-strategy        bigint | number | string  (default: bigint)
  -h, --help
  -v, --version
```

---

## XSD Type Mapping

### Primitive Types

| XSD Type | Zod Output |
|---|---|
| `xs:string` | `z.string()` |
| `xs:boolean` | `z.boolean()` |
| `xs:integer` | `z.number().int()` |
| `xs:int` | `z.number().int().min(-2147483648).max(2147483647)` |
| `xs:long` | `z.bigint()` ⚠ (see Numeric Precision below) |
| `xs:unsignedLong` | `z.bigint().min(0n)` ⚠ (see Numeric Precision below) |
| `xs:short` | `z.number().int().min(-32768).max(32767)` |
| `xs:byte` | `z.number().int().min(-128).max(127)` |
| `xs:decimal` | `z.number()` |
| `xs:float` | `z.number()` |
| `xs:double` | `z.number()` |
| `xs:positiveInteger` | `z.number().int().positive()` |
| `xs:nonNegativeInteger` | `z.number().int().min(0)` |
| `xs:nonPositiveInteger` | `z.number().int().max(0)` |
| `xs:negativeInteger` | `z.number().int().negative()` |
| `xs:unsignedInt` | `z.number().int().min(0).max(4294967295)` |
| `xs:date` | `z.string().date()` (or `z.date()` with `--date-strategy=date`) |
| `xs:dateTime` | `z.string().datetime()` |
| `xs:time` | `z.string().time()` |
| `xs:duration` | `z.string().regex(/^-?P.../)` |
| `xs:anyURI` | `z.string().url()` |
| `xs:base64Binary` | `z.string().base64()` |
| `xs:hexBinary` | `z.string().regex(/^[0-9a-fA-F]*$/)` |
| `xs:anyType` | `z.unknown()` |
| `xs:anySimpleType` | `z.union([z.string(), z.number(), z.boolean()])` |

#### Numeric Precision

`xs:long` (−2⁶³ to 2⁶³−1) and `xs:unsignedLong` (0 to 2⁶⁴−1) exceed
`Number.MAX_SAFE_INTEGER` (2⁵³−1). Mapping them to `z.number().int()` silently
loses precision for large values. The default output is therefore `z.bigint()`.

This is controlled by the `longStrategy` option:

| Strategy | Zod output | Trade-off |
|---|---|---|
| `"bigint"` (default) | `z.bigint()` | Precise; requires callers to use `BigInt` literals |
| `"number"` | `z.number().int()` | Convenient; silently wrong above 2⁵³−1 |
| `"string"` | `z.string().regex(/^-?[0-9]+$/)` | Always safe; caller must convert manually |

### Structural Constructs

| XSD Construct | Zod Output |
|---|---|
| `xs:complexType` with `xs:sequence` | `z.object({ ... })` |
| `xs:complexType` with `xs:all` | `z.object({ ... })` — each child's optionality follows its own `minOccurs` (0 or 1 only); `xs:all` constrains ordering, not optionality |
| `xs:choice` | Union-of-object-variants (`z.discriminatedUnion` when a discriminant exists, else `z.union`); falls back to object-with-optional-fields + `.superRefine` for exactly-one enforcement when branch shapes overlap |
| `xs:extension` (inheritance) | `BaseSchema.extend({ ... })` |
| `xs:simpleType` with `xs:list` | `z.array(...)` (with string preprocessor) |
| `xs:union` of simple types | `z.union([...])` |
| `xs:any` | `z.record(z.string(), z.unknown())` |
| `xs:anyAttribute` | `z.record(z.string(), z.unknown())` |
| `xs:group` / `xs:attributeGroup` | Inlined at reference sites |

### Facets (Restrictions)

| XSD Facet | Zod Output |
|---|---|
| `xs:minLength` | `.min(n)` |
| `xs:maxLength` | `.max(n)` |
| `xs:length` | `.length(n)` |
| `xs:pattern` | `.regex(...)` — partial support; XSD patterns are implicitly anchored and use constructs (`\i`, `\c`, class subtraction) that have no JS equivalent. Translatable patterns are converted; unsupported patterns emit a warning and fall back to `z.string()`. |
| `xs:enumeration` | `z.enum([...])` or `z.union([z.literal(...), ...])` |
| `xs:minInclusive` | `.min(n)` |
| `xs:maxInclusive` | `.max(n)` |
| `xs:minExclusive` | `.min(n+1)` / `.gt(n)` |
| `xs:maxExclusive` | `.max(n-1)` / `.lt(n)` |
| `xs:totalDigits` | `.superRefine(...)` |
| `xs:fractionDigits` | `.superRefine(...)` |

### Cardinality

| XSD | Zod modifier |
|---|---|
| `minOccurs="0"` | `.optional()` |
| `maxOccurs="unbounded"` or `> 1` | `z.array(...)` |
| `minOccurs="0" maxOccurs="unbounded"` | `z.array(...).optional()` |

---

## XML Metadata

Zod schemas validate data shape but lose information that is essential for
serialising a JS object back to well-formed XML:

- **Element vs attribute** — both are plain object fields in Zod, but they
  serialise completely differently.
- **Sequence ordering** — `xs:sequence` requires child elements in a fixed
  order; JavaScript object keys have no guaranteed order.
- **Choice groups** — fields inside `xs:choice` are mutually exclusive; Zod
  cannot express this constraint across object keys.
- **Original XML names** — camelCased JS keys (`houseNumber`) must round-trip
  to their original XML names (`house-number`).
- **Text content** — `xs:simpleContent` produces a type with both text content
  and attributes; the text needs a dedicated field (`$text`).

For every generated `*Schema` the generator also emits a companion `*Meta`
object that captures all of this information.

### Types

```ts
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
   *
   * Example — <items><item>a</item><item>b</item></items>
   *   wrapperXmlName = "items", xmlName = "item"
   */
  wrapperXmlName?: string;

  /** XSD default value; used when the field is absent during serialisation */
  default?: string;

  /** XSD fixed value; must always equal this value */
  fixed?: string;

  /** Whether the element accepts xsi:nil="true" */
  nillable?: boolean;
}

export interface XmlTypeMeta<T extends z.ZodTypeAny = z.ZodTypeAny> {
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

  /** True when the XSD type is abstract="true" */
  abstract?: boolean;

  /** True when the XSD type allows mixed content (text + child elements) */
  mixed?: boolean;
}

/** Convenience alias used in generated code */
export type XmlMeta<T extends z.ZodTypeAny = z.ZodTypeAny> = XmlTypeMeta<T>;
```

### Example — xs:sequence with attributes

```xml
<xs:complexType name="Address">
  <xs:sequence>
    <xs:element name="street"       type="xs:string"/>
    <xs:element name="house-number" type="xs:integer"/>
    <xs:element name="tag"          type="xs:string" maxOccurs="unbounded" minOccurs="0"/>
  </xs:sequence>
  <xs:attribute name="country-code" type="xs:string" use="required"/>
</xs:complexType>
```

```ts
export const AddressSchema = z.object({
  street:      z.string(),
  houseNumber: z.number().int(),
  tag:         z.array(z.string()).optional(),
  countryCode: z.string(),
});

export const AddressMeta: XmlMeta<typeof AddressSchema> = {
  xmlName:    "Address",
  compositor: "sequence",
  fields: {
    street:      { kind: "element",   xmlName: "street",        order: 0 },
    houseNumber: { kind: "element",   xmlName: "house-number",  order: 1 },
    tag:         { kind: "element",   xmlName: "tag",           order: 2 },
    countryCode: { kind: "attribute", xmlName: "country-code" },
  },
};
```

### Example — xs:choice inside xs:sequence

Fields in an `xs:choice` share the same `order` value and are linked via a
`choiceGroup` ID. A serialiser uses this to enforce that exactly one is present
and to place it at the correct position.

```xml
<xs:complexType name="Payment">
  <xs:sequence>
    <xs:element name="currency" type="xs:string"/>
    <xs:choice>
      <xs:element name="credit-card"    type="CreditCard"/>
      <xs:element name="bank-transfer"  type="BankTransfer"/>
    </xs:choice>
  </xs:sequence>
</xs:complexType>
```

```ts
export const PaymentSchema = z.object({
  currency:     z.string(),
  creditCard:   CreditCardSchema.optional(),
  bankTransfer: BankTransferSchema.optional(),
});

export const PaymentMeta: XmlMeta<typeof PaymentSchema> = {
  xmlName:    "Payment",
  compositor: "sequence",
  fields: {
    currency:     { kind: "element", xmlName: "currency",      order: 0 },
    creditCard:   { kind: "element", xmlName: "credit-card",   order: 1, choiceGroup: "choice_0" },
    bankTransfer: { kind: "element", xmlName: "bank-transfer", order: 1, choiceGroup: "choice_0" },
  },
  choiceGroups: {
    choice_0: ["creditCard", "bankTransfer"],
  },
};
```

### Example — xs:simpleContent (text + attributes)

When a complex type carries text content alongside attributes, the text is
exposed as a `$text` field with `kind: "text"`.

```xml
<xs:complexType name="Quantity">
  <xs:simpleContent>
    <xs:extension base="xs:decimal">
      <xs:attribute name="unit" type="xs:string" use="required"/>
    </xs:extension>
  </xs:simpleContent>
</xs:complexType>
```

```ts
export const QuantitySchema = z.object({
  $text: z.number(),
  unit:  z.string(),
});

export const QuantityMeta: XmlMeta<typeof QuantitySchema> = {
  xmlName:    "Quantity",
  compositor: "none",
  fields: {
    $text: { kind: "text",      xmlName: "#text" },
    unit:  { kind: "attribute", xmlName: "unit" },
  },
};
```

---

## Phased Implementation Plan

### Phase 1 — MVP

Goal: handle the most common patterns found in real-world XSDs.

- [ ] Project scaffold: TypeScript, ESM, `tsup` build, `vitest` tests
- [ ] XML parsing layer using `fast-xml-parser`
- [ ] All primitive type mappings (including `xs:long`/`xs:unsignedLong` → `z.bigint()`)
- [ ] `xs:complexType` with `xs:sequence` → `z.object` + `XmlMeta` with `compositor: "sequence"` and `order`
- [ ] `xs:element` cardinality (`minOccurs`, `maxOccurs`) → optional / array
- [ ] Basic namespace-aware type resolver: handle `targetNamespace` and prefixed references (`tns:MyType`) in single-file schemas — required for named type references to work at all
- [ ] Named type references (`type="xs:..."` and `type="MyType"`)
- [ ] `xs:simpleType` with `xs:enumeration` → `z.enum`
- [ ] `xs:attribute` → object fields with `kind: "attribute"` in metadata
- [ ] Original XML names preserved in `XmlFieldMeta.xmlName` (camelCase in JS key)
- [ ] Error/warning collection (see Error and Warning Contract)
- [ ] CLI: `xsd2zod input.xsd [-o output.ts]`

### Phase 2 — Restrictions & Composition

- [ ] `xs:restriction` facets (minLength, maxLength, min/max values)
- [ ] `xs:pattern` facet — partial support with warnings for untranslatable XSD regex constructs
- [ ] `xs:choice` — prefer union-of-object-variants (`z.discriminatedUnion` when a discriminant exists, `z.union` otherwise); fall back to object-with-optional-fields + `.superRefine` for exactly-one enforcement when branch shapes overlap; emit `choiceGroups` in metadata
- [ ] `xs:extension` → `.extend()` + merged metadata
- [ ] `xs:all` → `z.object` with per-child `minOccurs` respected (not all-optional); `compositor: "all"` in metadata; validate that no child has `maxOccurs > 1`
- [ ] `xs:simpleContent` → `$text` field with `kind: "text"` + `compositor: "none"`
- [ ] `xs:simpleType` with `xs:union` → `z.union`
- [ ] `xs:simpleType` with `xs:list` → `z.array` with string-split preprocessor
- [ ] `xs:group` and `xs:attributeGroup` inlining
- [ ] `default` and `fixed` attribute values in metadata
- [ ] `nillable="true"` → additional `.nullable()` layer + `nillable` flag in metadata (distinct from `absenceStrategy`)

### Phase 3 — Multi-file & Edge Cases

- [ ] `xs:include` and `xs:import` resolution (relative file paths + namespace merging)
- [ ] Circular/recursive type detection → `z.lazy(() => ...)` with explicit `z.ZodType<T>` annotation; declarations topologically sorted to avoid forward references
- [ ] `xs:any` / `xs:anyAttribute` → `z.unknown()` / `z.record`
- [ ] Namespace URI tracking in metadata
- [ ] Wrapped array pattern detection → `wrapperXmlName` in metadata
- [ ] `coerce` option for XML string inputs
- [ ] Abstract types → `abstract: true` in metadata

---

## Error and Warning Contract

Unsupported or partially-supported constructs must not fail silently. The
programmatic API returns a result object rather than a bare string:

```ts
interface Xsd2ZodResult {
  /** Generated TypeScript source */
  code: string;
  /** Non-fatal issues: partial support, precision risks, unsupported features */
  warnings: Xsd2ZodWarning[];
}

interface Xsd2ZodWarning {
  /** Machine-readable code for filtering/handling specific cases */
  code: WarningCode;
  message: string;
  /** Dot-separated path into the XSD structure, e.g. "Person.address.street" */
  xsdPath: string;
}

type WarningCode =
  | "UNSUPPORTED_CONSTRUCT"   // construct skipped entirely (e.g. xs:key, substitution groups)
  | "PARTIAL_REGEX"           // xs:pattern could not be fully translated to JS regex
  | "PRECISION_LOSS"          // numeric type mapped with --long-strategy=number
  | "ABSTRACT_TYPE"           // abstract type emitted as its base type
  | "CIRCULAR_REF"            // z.lazy emitted; explicit type annotation required
  | "UNRESOLVED_TYPE_REF";    // type reference could not be resolved (emits z.unknown())
```

By default the generator collects all warnings and returns them alongside the
output. Passing `{ strict: true }` causes it to throw on the first warning
instead. The CLI prints warnings to stderr and exits non-zero only with
`--strict`.

---

## Testing Plan

### Strategy

Tests are written with [Vitest](https://vitest.dev). The suite has four layers:

```
tests/
├── unit/           # isolated tests for each internal module
│   ├── parser/     # XSD XML → XsdSchema
│   ├── transformer/# XsdSchema → SchemaNode IR
│   └── generator/  # SchemaNode IR → TypeScript string
├── integration/    # full pipeline: XSD string → TypeScript string
├── fixtures/       # shared .xsd input files and expected .ts snapshots
│   ├── primitives/
│   ├── complex-types/
│   ├── restrictions/
│   ├── choice/
│   ├── extension/
│   ├── multi-file/
│   └── real-world/
└── cli/            # CLI invocation tests via execa
```

### Unit Tests

Each stage is tested in isolation with controlled inputs:

- **Parser**: Feed raw XSD strings, assert the `XsdSchema` object produced.
- **Transformer**: Feed `XsdSchema` objects directly, assert `SchemaNode` output.
- **Generator (schema)**: Feed `SchemaNode` trees directly, assert Zod TypeScript string output.
- **Generator (meta)**: Feed `SchemaNode` trees directly, assert `XmlMeta` literal output —
  correct `kind`, `xmlName`, `order`, `choiceGroup`, `compositor`, etc.

This makes it fast to diagnose which stage a regression lives in.

### Integration / Snapshot Tests

Each fixture pair is an `.xsd` file and a corresponding `.ts` snapshot:

```
fixtures/complex-types/sequence.xsd
fixtures/complex-types/sequence.ts   ← committed expected output
```

The integration test reads each `.xsd`, runs the full pipeline, and compares the
output to the snapshot. Snapshots are committed to the repo and updated
intentionally with `vitest --update-snapshots`.

**Fixture categories:**

| Category | What it covers |
|---|---|
| `primitives` | All XSD built-in types, one per file |
| `complex-types` | sequence, all, nesting, attributes; correct `order` and `compositor` in meta |
| `restrictions` | Each facet (minLength, pattern, enum, ...) |
| `choice` | Simple choice, discriminated, nested; `choiceGroups` and shared `order` in meta |
| `simple-content` | Text + attributes; `$text` with `kind: "text"` and `compositor: "none"` |
| `extension` | Single inheritance, multi-level; merged metadata |
| `multi-file` | xs:include, xs:import with relative paths |
| `real-world` | Subset of public XSDs (e.g., SOAP envelope, HL7, Maven POM) |
| `circular` | Self-referential and mutually-recursive types |

### Property-Based Tests (post-Phase 2)

Property-based tests are deferred until the fixture suite is stable. Generating
structurally valid XSD with [fast-check](https://github.com/dubzzz/fast-check)
is significant work in itself and should not compete with deterministic fixture
coverage in early phases.

Once introduced, they assert:

1. The pipeline does not throw (or only emits warnings with known codes).
2. The output is valid TypeScript (parsed with the TypeScript compiler API).
3. The output contains only whitelisted Zod API calls.

### Runtime Validation Tests

For a selection of fixtures, a test:

1. Generates the Zod schema and `XmlMeta` code.
2. Dynamically `eval`s / imports it.
3. Runs known-valid and known-invalid sample data through `schema.safeParse(...)`.
4. Asserts the results match expectations.
5. Verifies that using the `XmlMeta` to re-serialise the parsed object produces
   elements in the correct `order`, with attributes vs elements in the right
   positions, and with only one branch of each `choiceGroup` present.

This catches type mapping bugs and metadata round-trip bugs that snapshot tests
might miss.

### CLI Tests

Use [execa](https://github.com/sindresorhus/execa) to invoke the built CLI
binary and assert:

- Correct output to stdout and to `-o` files.
- Correct exit codes for missing files and invalid XSD.
- `--help` and `--version` output.

### Coverage Target

Aim for ≥ 90% line coverage on the `src/` directory. CI fails below 80%.

---

## Project Structure

```
xsd2zod/
├── src/
│   ├── index.ts          # public API exports (xsd2zod, xsd2zodFile, XmlMeta, XmlFieldMeta, …)
│   ├── meta-types.ts     # XmlFieldMeta, XmlTypeMeta, XmlMeta type definitions
│   ├── parser/
│   │   ├── index.ts      # entry: string → XsdSchema
│   │   └── types.ts      # XsdSchema, XsdElement, XsdType, … interfaces
│   ├── transformer/
│   │   ├── index.ts      # entry: XsdSchema → SchemaNode
│   │   ├── types.ts      # SchemaNode union types (carry both Zod shape and XmlFieldMeta)
│   │   └── primitives.ts # XSD built-in type → SchemaNode map
│   ├── generator/
│   │   ├── index.ts      # entry: SchemaNode → string (schema + meta)
│   │   ├── schema.ts     # emit Zod schema declarations
│   │   ├── meta.ts       # emit XmlMeta object literals
│   │   └── naming.ts     # identifier sanitisation / camelCase
│   └── cli.ts            # CLI entry point
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── cli/
│   └── fixtures/
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

---

## Development Setup

```sh
npm install
npm run build   # tsup
npm test        # vitest run
npm run dev     # vitest watch
```

---

## Dependencies

| Package | Role |
|---|---|
| `fast-xml-parser` | XSD/XML parsing |
| `zod` | Peer dependency (generated code imports it) |

**Dev only:** `typescript`, `tsup`, `vitest`, `fast-check`, `execa`

---

## Prior Art

- [`xsd-to-zod`](https://www.npmjs.com/package/xsd-to-zod) — a new v0.1.1 package (Feb 2026) with minimal features
- [`cxsd`](https://www.npmjs.com/package/cxsd) — XSD → TypeScript `.d.ts`, last published 2015
- [`xsd2ts`](https://www.npmjs.com/package/xsd2ts) — XSD → TypeScript classes, largely stale
- [`json-schema-to-zod`](https://www.npmjs.com/package/json-schema-to-zod) — inspiration for the generator layer
