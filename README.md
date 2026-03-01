# xsd2zod

Convert XSD schemas into [Zod](https://zod.dev) validators and XML serializers — with full TypeScript types and XML metadata.

## Install

```bash
npm install github:markusopd/xsd2zod
```

## Usage

### Generate Zod schemas from an XSD

```ts
import { xsd2zod } from "xsd2zod";
import { readFileSync } from "node:fs";

const xsd = readFileSync("schema.xsd", "utf-8");
const { code, warnings } = xsd2zod(xsd);

console.log(code); // TypeScript source — save to a .ts file
```

### CLI

```bash
npx xsd2zod schema.xsd               # print to stdout
npx xsd2zod schema.xsd -o output.ts  # write to file
```

### Validate XML data

The generated file exports a Zod schema and an `XmlMeta` object per type:

```ts
// generated output.ts
import { PersonSchema, PersonMeta } from "./output.js";

const person = PersonSchema.parse({
  name: "Alice",
  age: 30,
  address: { street: "Main St", city: "Oslo" },
});
```

### Serialize back to XML

`objectToXml` is also available as a standalone browser-safe subpath import with no Node.js dependencies:

```ts
// Node.js — import from the main entry
import { objectToXml } from "xsd2zod";

// Browser / client-side — use the subpath (no fs/promises dependency)
import { objectToXml } from "xsd2zod/serializer";

import { PersonMeta } from "./output.js";

const xml = objectToXml(person, PersonMeta, { indent: "  " });
console.log(xml);
// <Person>
//   <name>Alice</name>
//   <age>30</age>
//   <address>
//     <street>Main St</street>
//     <city>Oslo</city>
//   </address>
// </Person>
```

### Options

```ts
xsd2zod(xsd, {
  coerce: true,            // use z.coerce.* for XML string inputs
  absenceStrategy: "optional" | "nullable" | "nullish",
  longStrategy: "bigint" | "number" | "string",
  dateStrategy: "string" | "date",
  strict: false,           // throw on first warning instead of collecting
});

objectToXml(value, meta, {
  rootElement: "MyRoot",   // override root element name
  indent: "  ",            // pretty-print indentation
  namespace: "http://example.com/ns",
});
```
