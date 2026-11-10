/**
 * Font parsing and subsetting. Knows font file formats and nothing about PDF.
 */

export { Font, type FontSubset, loadFont } from "./font.ts";
export type { OutlineCommand } from "./outline.ts";
export {
  openTypeShaper,
  type ShapableFont,
  type ShapedGlyph,
  type ShapeOptions,
  type Shaper,
} from "./shaper.ts";
export type { NamedInstance, VariationAxis } from "./variations.ts";
export { type BrotliDecoder, builtinBrotli, decodeWoff2, isWoff2, unwrapFont } from "./woff2.ts";
