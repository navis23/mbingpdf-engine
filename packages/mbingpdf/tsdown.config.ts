import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: {
    index: "src/index.ts",
    "jsx-runtime": "src/jsx-runtime.ts",
    "jsx-dev-runtime": "src/jsx-dev-runtime.ts",
    "barcode/index": "src/barcode/index.ts",
    "core/index": "src/core/index.ts",
    "font/index": "src/font/index.ts",
    "image/index": "src/image/index.ts",
    "qr/index": "src/qr/index.ts",
    "svg/index": "src/svg/index.ts",
    "text/index": "src/text/index.ts",
  },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2023",
  dts: true,
  // No source maps: the sources are not shipped, so the maps would point at nothing.
  sourcemap: false,
  clean: true,
  // fflate is compiled into the output, so the published package has no runtime dependencies.
  deps: { onlyBundle: ["fflate"] },
});

export default config;
