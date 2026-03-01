import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
  },
  {
    entry: {
      serializer: "src/serializer/index.ts",
      "meta-types": "src/meta-types.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: false,
    sourcemap: true,
    splitting: false,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
  },
]);
