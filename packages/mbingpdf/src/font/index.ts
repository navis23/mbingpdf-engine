/**
 * Font parsing and subsetting. Knows font file formats and nothing about PDF.
 */

export {
  openTypeShaper,
  type ShapableFont,
  type ShapedGlyph,
  type ShapeOptions,
  type Shaper,
} from "./shaper.ts";
export { type FontSubset, TrueTypeFont } from "./truetype.ts";
export type { NamedInstance, VariationAxis } from "./variations.ts";
