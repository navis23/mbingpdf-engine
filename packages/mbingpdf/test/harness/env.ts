/** The sample environment for tests that run against the source. Node only. */
import { readFileSync } from "node:fs";
import * as core from "../../src/core/index.ts";
import * as font from "../../src/font/index.ts";
import * as doc from "../../src/index.ts";
import * as text from "../../src/text/index.ts";
import { ALL_FONT_FILES, type FontFile, fontFileName, type SampleEnv } from "./samples.ts";

/** Reads a test font as a plain Uint8Array (not a Buffer, whose slice() does not copy). */
export function readFont(file: FontFile): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fonts/${fontFileName(file)}`, import.meta.url)));
}

export const env: SampleEnv = {
  core,
  font,
  text,
  doc,
  photo: new Uint8Array(readFileSync(new URL("../images/photo.jpg", import.meta.url))),
  icc: new Uint8Array(readFileSync(new URL("../icc/CGATS001Compat-v2-micro.icc", import.meta.url))),
  fonts: Object.fromEntries(ALL_FONT_FILES.map((file) => [file, readFont(file)])) as Record<
    FontFile,
    Uint8Array
  >,
};
