import type { ByteWriter } from "./bytes.ts";
import { PdfString } from "./objects.ts";
import { formatNumber, writeObject } from "./serialize.ts";

/** A glyph as a shaper returns it. Distances are in font units. */
export interface PositionedGlyph {
  /** Glyph ID in the font; 0 when the font has no glyph for the character. */
  readonly id: number;
  /** UTF-16 offset in the text of the first character the glyph stands for. */
  readonly cluster: number;
  readonly xAdvance: number;
  readonly xOffset: number;
  readonly yOffset: number;
}

/** How one kind of font turns glyphs into the bytes of a PDF string. */
export interface GlyphEncoder {
  readonly unitsPerEm: number;
  /** Two-byte glyph IDs written in hex, or one-byte codes written as a literal string. */
  readonly bytesPerGlyph: 1 | 2;
  /**
   * The code to write for a glyph, given the text its cluster stands for (only passed for the
   * first glyph of a cluster). Undefined means "draw nothing, but keep the space".
   */
  code(glyph: number, clusterText: string | undefined): number | undefined;
  /** The advance a viewer applies for the glyph, in thousandths of the font size. */
  width(glyph: number): number;
}

/**
 * Writes the operators that show a run of positioned glyphs: a `Tj`, or a `TJ` array when
 * kerning, spacing or accent placement moves glyphs away from their plain advance. Glyphs
 * raised off the baseline are bracketed by text-rise changes.
 */
export function writeGlyphRun(
  out: ByteWriter,
  encoder: GlyphEncoder,
  glyphs: readonly PositionedGlyph[],
  text: string,
  size: number,
  rise: number,
): void {
  const scale = 1000 / encoder.unitsPerEm;
  const number = (value: number): string => formatNumber(value, 3);

  // A TJ array alternates strings with shifts in thousandths of the font size.
  let items = 0;
  let pendingArray = "";
  let run: number[] = [];
  /** Distance the pen still has to move right before the next glyph, in thousandths. */
  let shift = 0;
  let currentRise = rise;

  const closeString = (): void => {
    if (run.length === 0) return;
    const bytes = Uint8Array.from(run);
    const start = out.length;
    writeObject(out, new PdfString(bytes, encoder.bytesPerGlyph === 2));
    // Buffer the string so that a lone string can become a Tj instead of a one-item TJ.
    pendingArray += String.fromCharCode(...out.toBytes().subarray(start));
    out.truncate(start);
    items++;
    run = [];
  };
  const flush = (): void => {
    closeString();
    if (items === 1 && !/^-?[\d.]/.test(pendingArray)) out.ascii(`${pendingArray} Tj\n`);
    else if (items > 0) out.ascii(`[${pendingArray}] TJ\n`);
    items = 0;
    pendingArray = "";
  };
  const applyShift = (): void => {
    if (Math.abs(shift) < 0.0005) return;
    closeString();
    // TJ numbers move the pen left, so the sign flips.
    const value = number(-shift);
    // Two numbers in a row need a separator; a string delimits itself.
    pendingArray += /[\d.]$/.test(pendingArray) ? ` ${value}` : value;
    items++;
    shift = 0;
  };

  glyphs.forEach((glyph, i) => {
    // The first glyph of a cluster carries the cluster's text for copy and search.
    let clusterText: string | undefined;
    if (i === 0 || glyphs[i - 1]?.cluster !== glyph.cluster) {
      let end = text.length;
      for (let j = i + 1; j < glyphs.length; j++) {
        const next = (glyphs[j] as PositionedGlyph).cluster;
        if (next !== glyph.cluster) {
          end = next;
          break;
        }
      }
      clusterText = text.slice(glyph.cluster, end);
    }
    const code = encoder.code(glyph.id, clusterText);
    if (code === undefined) {
      shift += glyph.xAdvance * scale;
      return;
    }

    const glyphRise = rise + (glyph.yOffset * size) / encoder.unitsPerEm;
    if (Math.abs(glyphRise - currentRise) >= 0.0005) {
      applyShift();
      flush();
      out.ascii(`${number(glyphRise)} Ts\n`);
      currentRise = glyphRise;
    }
    shift += glyph.xOffset * scale;
    applyShift();
    if (encoder.bytesPerGlyph === 2) run.push(code >> 8, code & 0xff);
    else run.push(code);
    shift += (glyph.xAdvance - glyph.xOffset) * scale - encoder.width(glyph.id);
  });
  applyShift();
  flush();
  if (Math.abs(currentRise - rise) >= 0.0005) out.ascii(`${number(rise)} Ts\n`);
}
