import type { PositionedGlyph } from "./glyph-run.ts";
import type { StandardEncodingData, StandardFontData } from "./standard-font-data.ts";
import { symbolEncoding, win1252Encoding, zapfdingbatsEncoding } from "./standard-font-data.ts";

const ENCODINGS: Record<StandardFontData["encoding"], StandardEncodingData> = {
  win1252: win1252Encoding,
  symbol: symbolEncoding,
  zapfdingbats: zapfdingbatsEncoding,
};

/** Unicode code point → character code, built on first use and shared between fonts. */
const encodingMaps: Map<StandardEncodingData, Map<number, number>> = new Map();

function encodingMap(data: StandardEncodingData): Map<number, number> {
  let map = encodingMaps.get(data);
  if (!map) {
    map = new Map();
    for (let i = 0; i < data.pairs.length; i += 2) {
      map.set(data.pairs[i] as number, data.pairs[i + 1] as number);
    }
    encodingMaps.set(data, map);
  }
  return map;
}

function describe(codePoint: number): string {
  const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
  return `"${String.fromCodePoint(codePoint)}" (U+${hex})`;
}

/**
 * One of the 14 fonts every PDF viewer provides, so nothing is embedded in the file.
 *
 * The text fonts cover Windows-1252 (Western European languages, including English and
 * Indonesian); Symbol and ZapfDingbats cover their own glyph sets. For anything else, embed a
 * font. Metrics are in thousandths of the font size unless a size is passed in.
 */
export class StandardFont {
  /** The PostScript name, such as `Helvetica-Bold`. */
  readonly name: string;
  readonly ascender: number;
  readonly descender: number;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly bbox: readonly [number, number, number, number];
  readonly italicAngle: number;
  readonly underlinePosition: number;
  readonly underlineThickness: number;
  /** True for Symbol and ZapfDingbats, which use their built-in encoding. */
  readonly symbolic: boolean;
  /** Metrics of the standard fonts are always in thousandths of the font size. */
  readonly unitsPerEm = 1000;
  /**
   * Extra space between lines. The standard fonts do not define one, so this is chosen to give
   * a line spacing of 1.15 times the font size, the usual default for these typefaces.
   */
  readonly lineGap: number;
  readonly #data: StandardFontData;
  #widths: Float64Array | undefined;

  constructor(data: StandardFontData) {
    this.#data = data;
    this.name = data.name;
    this.ascender = data.ascender;
    this.descender = data.descender;
    this.capHeight = data.capHeight;
    this.xHeight = data.xHeight;
    this.bbox = data.bbox;
    this.italicAngle = data.italicAngle;
    this.underlinePosition = data.underlinePosition;
    this.underlineThickness = data.underlineThickness;
    this.symbolic = data.encoding !== "win1252";
    this.lineGap = Math.max(0, 1150 - (data.ascender - data.descender));
  }

  /** Whether the font has a glyph for every character of `text`. */
  canEncode(text: string): boolean {
    const map = encodingMap(ENCODINGS[this.#data.encoding]);
    for (const char of text) {
      if (!map.has(char.codePointAt(0) as number)) return false;
    }
    return true;
  }

  /** Same as {@link canEncode}; the name embedded fonts use. */
  hasGlyphsFor(text: string): boolean {
    return this.canEncode(text);
  }

  /**
   * One glyph per character at its plain width; the standard fonts have no kerning data
   * bundled. The glyph ID is the character code, or 0 for a character the font lacks.
   * Invisible formatting characters such as the soft hyphen produce no glyph.
   */
  shape(text: string): PositionedGlyph[] {
    const map = encodingMap(ENCODINGS[this.#data.encoding]);
    const widths = this.#widthTable();
    const glyphs: PositionedGlyph[] = [];
    for (let i = 0; i < text.length; ) {
      const codePoint = text.codePointAt(i) as number;
      const cluster = i;
      i += codePoint > 0xffff ? 2 : 1;
      if (
        codePoint === 0x00ad ||
        (codePoint >= 0x200b && codePoint <= 0x200f) ||
        codePoint === 0x2060
      ) {
        continue;
      }
      const id = map.get(codePoint) ?? 0;
      glyphs.push({ id, cluster, xAdvance: widths[id] as number, xOffset: 0, yOffset: 0 });
    }
    return glyphs;
  }

  /** The advance of a character code, in thousandths of the font size. */
  advanceOfCode(code: number): number {
    return this.#widthTable()[code] ?? 0;
  }

  /** Converts text to the font's one-byte character codes. Throws on a character it lacks. */
  encode(text: string): Uint8Array {
    const map = encodingMap(ENCODINGS[this.#data.encoding]);
    const out = new Uint8Array(text.length);
    let length = 0;
    for (const char of text) {
      const codePoint = char.codePointAt(0) as number;
      const code = map.get(codePoint);
      if (code === undefined) {
        throw new RangeError(`${this.name} has no glyph for ${describe(codePoint)}`);
      }
      out[length++] = code;
    }
    return out.subarray(0, length);
  }

  /** The advance width of `text` at `size`, in points. Throws on a character the font lacks. */
  widthOfText(text: string, size: number): number {
    const widths = this.#widthTable();
    let total = 0;
    for (const code of this.encode(text)) total += widths[code] as number;
    return (total * size) / 1000;
  }

  /** Distance from the baseline to the top of tall letters at `size`. */
  ascent(size: number): number {
    return (this.ascender * size) / 1000;
  }

  /** Distance from the baseline to the bottom of descenders at `size`, as a positive number. */
  descent(size: number): number {
    return (-this.descender * size) / 1000;
  }

  #widthTable(): Float64Array {
    if (!this.#widths) {
      const table = new Float64Array(256);
      const packed = this.#data.widths;
      if (packed.includes(",")) {
        packed.split(",").forEach((width, i) => {
          if (width !== "") table[i + 32] = Number(width);
        });
      } else {
        table.fill(Number(packed), 32);
      }
      this.#widths = table;
    }
    return this.#widths;
  }
}
