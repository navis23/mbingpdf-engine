import { expect, test } from "vitest";
import { PDF_VERSION } from "../src/index.ts";

test("package entry point loads", () => {
  expect(PDF_VERSION).toBe("1.7");
});
