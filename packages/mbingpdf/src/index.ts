/**
 * `mbingpdf` — describe a document, get a PDF.
 *
 * This entry point has everything needed to build documents: the elements, `render`, units,
 * colours and font loading. The lower layers remain available on their own as
 * `mbingpdf/core`, `mbingpdf/font`, `mbingpdf/text` and `mbingpdf/image`.
 */
export {
  type Color,
  cm,
  cmyk,
  gray,
  hex,
  inch,
  mm,
  PageSizes,
  type PdfImage,
  rgb,
  StandardFonts,
} from "./core/index.ts";
export { Font, loadFont } from "./font/index.ts";
export { decodeImage } from "./image/index.ts";
export * from "./layout/index.ts";
export {
  fitText,
  type Hyphenator,
  hyphenateEnglish,
  hyphenateIndonesian,
  type TextAlign,
  type TextFont,
} from "./text/index.ts";
