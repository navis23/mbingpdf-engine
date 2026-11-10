import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The examples import the package by name; in tests that means the source.
    alias: {
      mbingpdf: fileURLToPath(new URL("./packages/mbingpdf/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
    // Rendering with pdf.js and PDFium takes a few seconds per document.
    testTimeout: 60_000,
  },
});
