import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (path: string): string =>
  fileURLToPath(new URL(`./packages/mbingpdf/src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // The examples and the framework packages import the package by name; in tests that means
    // the source.
    alias: [
      { find: /^mbingpdf$/, replacement: source("index.ts") },
      { find: /^mbingpdf\/svg$/, replacement: source("svg/index.ts") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
    // Rendering with pdf.js and PDFium takes a few seconds per document.
    testTimeout: 60_000,
  },
});
