import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: true,
  sourcemap: false,
  clean: true,
});

export default config;
