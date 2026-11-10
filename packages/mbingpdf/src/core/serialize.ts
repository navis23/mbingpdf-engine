import type { ByteWriter } from "./bytes.ts";
import { PdfDict, PdfName, type PdfObject, PdfRef, PdfStream, PdfString } from "./objects.ts";

const encoder: TextEncoder = new TextEncoder();
const HEX = "0123456789ABCDEF";

/** Characters that end a token: white space and delimiters (ISO 32000-1, 7.2.2). */
function isBoundary(byte: number): boolean {
  switch (byte) {
    case -1: // nothing written yet
    case 0x00:
    case 0x09:
    case 0x0a:
    case 0x0c:
    case 0x0d:
    case 0x20:
    case 0x28: // (
    case 0x29: // )
    case 0x3c: // <
    case 0x3e: // >
    case 0x5b: // [
    case 0x5d: // ]
    case 0x7b: // {
    case 0x7d: // }
    case 0x2f: // /
    case 0x25: // %
      return true;
    default:
      return false;
  }
}

/**
 * Formats a number the way PDF expects: no exponent, at most `decimals` fraction digits,
 * no trailing zeros.
 */
export function formatNumber(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) throw new RangeError(`Cannot write ${value} to a PDF`);
  if (Number.isInteger(value)) {
    if (!Number.isSafeInteger(value)) throw new RangeError(`Integer out of range: ${value}`);
    return String(value);
  }
  let text = value.toFixed(decimals);
  if (text.includes(".")) text = text.replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

function writeName(out: ByteWriter, value: string): void {
  out.byte(0x2f);
  for (const byte of encoder.encode(value)) {
    if (byte < 0x21 || byte > 0x7e || byte === 0x23 || isBoundary(byte)) {
      out.byte(0x23);
      out.ascii(HEX.charAt(byte >> 4) + HEX.charAt(byte & 0x0f));
    } else {
      out.byte(byte);
    }
  }
}

function writeString(out: ByteWriter, value: PdfString): void {
  if (value.hex) {
    out.byte(0x3c);
    for (const byte of value.bytes) out.ascii(HEX.charAt(byte >> 4) + HEX.charAt(byte & 0x0f));
    out.byte(0x3e);
    return;
  }
  out.byte(0x28);
  for (const byte of value.bytes) {
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) {
      out.byte(0x5c);
      out.byte(byte);
    } else if (byte === 0x0d) {
      // A raw CR would be read back as LF.
      out.ascii("\\r");
    } else {
      out.byte(byte);
    }
  }
  out.byte(0x29);
}

/** Writes a token that starts with a regular character, adding a space only if needed. */
function writeWord(out: ByteWriter, word: string): void {
  if (!isBoundary(out.last)) out.byte(0x20);
  out.ascii(word);
}

/** Writes one object in compact PDF syntax. Streams are rejected: they must be indirect. */
export function writeObject(out: ByteWriter, value: PdfObject): void {
  if (value === null) {
    writeWord(out, "null");
  } else if (typeof value === "boolean") {
    writeWord(out, value ? "true" : "false");
  } else if (typeof value === "number") {
    writeWord(out, formatNumber(value));
  } else if (value instanceof PdfName) {
    writeName(out, value.value);
  } else if (value instanceof PdfString) {
    writeString(out, value);
  } else if (value instanceof PdfRef) {
    writeWord(out, `${value.num} 0 R`);
  } else if (value instanceof PdfDict) {
    out.ascii("<<");
    for (const [key, entry] of value.entries()) {
      writeName(out, key);
      writeObject(out, entry);
    }
    out.ascii(">>");
  } else if (value instanceof PdfStream) {
    throw new TypeError(
      "A stream must be an indirect object; add it to the writer and use its ref",
    );
  } else if (Array.isArray(value)) {
    out.byte(0x5b);
    for (const item of value as readonly PdfObject[]) writeObject(out, item);
    out.byte(0x5d);
  } else {
    throw new TypeError(`Not a PDF object: ${String(value)}`);
  }
}
