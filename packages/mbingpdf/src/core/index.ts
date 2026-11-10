/**
 * `mbingpdf/core` — the PDF writer. Knows the file format and nothing about layout.
 */

export { ByteWriter } from "./bytes.ts";
export { type Color, cmyk, gray, hex, rgb, spot } from "./color.ts";
export {
  type AnyFont,
  type ContentResources,
  ContentStream,
  type FillRule,
  type FontBinding,
  type LineCap,
  type LineJoin,
  type Opacity,
  type TextRenderingMode,
} from "./content.ts";
export {
  type OutputIntent,
  PdfDocument,
  type PdfDocumentOptions,
  type PdfInfo,
} from "./document.ts";
export { EmbeddedFont, type FontProgram } from "./embedded-font.ts";
export type { PositionedGlyph } from "./glyph-run.ts";
export { orientationMatrix, orientedSize, type PdfImage } from "./image.ts";
export {
  dict,
  name,
  PdfDict,
  PdfName,
  type PdfObject,
  PdfRef,
  PdfStream,
  PdfString,
  str,
} from "./objects.ts";
export { PdfForm, PdfPage, type PdfPageOptions } from "./page.ts";
export { formatNumber, writeObject } from "./serialize.ts";
export { StandardFont } from "./standard-font.ts";
export * as StandardFonts from "./standard-fonts.ts";
export {
  type Box,
  cm,
  inch,
  mm,
  type PageSize,
  PageSizes,
  type PrintBoxes,
  printBoxes,
} from "./units.ts";
export { type PdfTrailer, PdfWriter, type PdfWriterOptions } from "./writer.ts";
