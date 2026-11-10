import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2023",
  dts: true,
  sourcemap: false,
  clean: true,
});

export default config;
