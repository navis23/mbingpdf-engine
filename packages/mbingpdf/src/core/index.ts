/**
 * `mbingpdf/core` — the PDF writer. Knows the file format and nothing about layout.
 */

export { ByteWriter } from "./bytes.ts";
export {
  PdfDocument,
  type PdfDocumentOptions,
  type PdfInfo,
  type PdfPageOptions,
} from "./document.ts";
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
export { formatNumber, writeObject } from "./serialize.ts";
export { type PdfTrailer, PdfWriter, type PdfWriterOptions } from "./writer.ts";
