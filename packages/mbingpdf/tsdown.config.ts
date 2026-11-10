import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: {
    index: "src/index.ts",
    "core/index": "src/core/index.ts",
    "font/index": "src/font/index.ts",
    "image/index": "src/image/index.ts",
    "svg/index": "src/svg/index.ts",
    "text/index": "src/text/index.ts",
  },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2023",
  dts: true,
  sourcemap: true,
  clean: true,
  // fflate is compiled into the output, so the published package has no runtime dependencies.
  deps: { onlyBundle: ["fflate"] },
});

export default config;
