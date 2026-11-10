/**
 * `mbingpdf/core` — the PDF writer. Knows the file format and nothing about layout.
 */

export { ByteWriter } from "./bytes.ts";
export { type Color, cmyk, gray, hex, rgb } from "./color.ts";
export {
  type ContentResources,
  ContentStream,
  type FillRule,
  type LineCap,
  type LineJoin,
  type Opacity,
} from "./content.ts";
export { PdfDocument, type PdfDocumentOptions, type PdfInfo } from "./document.ts";
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
export { PdfPage, type PdfPageOptions } from "./page.ts";
export { formatNumber, writeObject } from "./serialize.ts";
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
