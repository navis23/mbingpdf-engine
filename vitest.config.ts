import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // Rendering with pdf.js and PDFium takes a few seconds per document.
    testTimeout: 60_000,
  },
});
