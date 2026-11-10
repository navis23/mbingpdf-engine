/** The sample environment for tests that run against the source. Node only. */
import { readFileSync } from "node:fs";
import * as core from "../../src/core/index.ts";
import * as font from "../../src/font/index.ts";
import { FONT_FILES, type FontFile, type SampleEnv } from "./samples.ts";

/** Reads a test font as a plain Uint8Array (not a Buffer, whose slice() does not copy). */
export function readFont(file: FontFile): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fonts/${file}.ttf`, import.meta.url)));
}

export const env: SampleEnv = {
  core,
  font,
  fonts: Object.fromEntries(FONT_FILES.map((file) => [file, readFont(file)])) as Record<
    FontFile,
    Uint8Array
  >,
};
