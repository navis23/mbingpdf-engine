/**
 * HarfBuzz's font subsetter, from the WebAssembly build that ships with `harfbuzzjs`. Used as
 * the yardstick for the size of our own subsets. Node only.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

interface Exports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(
    data: number,
    length: number,
    mode: number,
    userData: number,
    destroy: number,
  ): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, value: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_set(input: number, type: number): number;
  hb_subset_input_pin_all_axes_to_default(input: number, face: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

let exports: Exports | undefined;

const SET_GLYPHS = 0;
const SET_DROP_TABLES = 3;

/** Tables a PDF does not use; our subsets leave them out, so HarfBuzz must too. */
const NOT_NEEDED = [
  "GSUB",
  "GPOS",
  "GDEF",
  "BASE",
  "JSTF",
  "name",
  "OS/2",
  "post",
  "cmap",
  "gasp",
  "DSIG",
  "STAT",
  "kern",
  "hdmx",
  "LTSH",
  "VDMX",
  "meta",
  "MATH",
];

const tag = (text: string): number =>
  ((text.charCodeAt(0) << 24) |
    (text.charCodeAt(1) << 16) |
    (text.charCodeAt(2) << 8) |
    text.charCodeAt(3)) >>>
  0;

/** Subsets `font` to the given glyphs with HarfBuzz, at the default position of any axes. */
export function harfbuzzSubset(font: Uint8Array, glyphs: readonly number[]): Uint8Array {
  if (!exports) {
    const require = createRequire(import.meta.url);
    const wasm = readFileSync(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"));
    const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), {});
    exports = instance.exports as unknown as Exports;
  }
  const hb = exports;
  const pointer = hb.malloc(font.length);
  new Uint8Array(hb.memory.buffer).set(font, pointer);
  const blob = hb.hb_blob_create(pointer, font.length, 2 /* writable */, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  const input = hb.hb_subset_input_create_or_fail();
  try {
    const glyphSet = hb.hb_subset_input_set(input, SET_GLYPHS);
    for (const glyph of glyphs) hb.hb_set_add(glyphSet, glyph);
    const dropSet = hb.hb_subset_input_set(input, SET_DROP_TABLES);
    for (const name of NOT_NEEDED) hb.hb_set_add(dropSet, tag(name));
    hb.hb_subset_input_pin_all_axes_to_default(input, face);
    const subset = hb.hb_subset_or_fail(face, input);
    if (subset === 0) throw new Error("hb_subset_or_fail failed");
    const result = hb.hb_face_reference_blob(subset);
    const length = hb.hb_blob_get_length(result);
    const data = hb.hb_blob_get_data(result, 0);
    const copy = new Uint8Array(hb.memory.buffer).slice(data, data + length);
    hb.hb_blob_destroy(result);
    hb.hb_face_destroy(subset);
    return copy;
  } finally {
    hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.hb_blob_destroy(blob);
    hb.free(pointer);
  }
}
