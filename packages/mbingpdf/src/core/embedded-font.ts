import { ByteWriter } from "./bytes.ts";
import { Hash128 } from "./hash.ts";
import { PdfDict, PdfName, type PdfRef, PdfStream, PdfString } from "./objects.ts";
import type { PdfWriter } from "./writer.ts";

/**
 * What the writer needs from a font in order to embed it. The font parsers in `mbingpdf/font`
 * satisfy this; the core does not depend on them.
 */
export interface FontProgram {
  readonly postScriptName: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly capHeight: number;
  readonly bbox: readonly [number, number, number, number];
  readonly italicAngle: number;
  readonly isFixedPitch: boolean;
  readonly isItalic: boolean;
  readonly weightClass: number;
  readonly embeddable: boolean;
  /** The glyph for a Unicode code point; 0 when the font has none. */
  glyphForCodePoint(codePoint: number): number;
  /** Advance width of a glyph in font units. */
  advanceWidth(glyph: number): number;
  /** A font file with only these glyphs, renumbered in order; see `TrueTypeFont.subset`. */
  subset(glyphs: readonly number[]): {
    readonly data: Uint8Array;
    readonly glyphs: readonly number[];
  };
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, "0");
}

/** UTF-16BE hex of a string, as ToUnicode CMaps want it. */
function utf16Hex(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += hex4(text.charCodeAt(i));
  return out;
}

/**
 * Tracks which glyphs of one font a document uses, and writes the subset font at the end.
 *
 * Glyphs get new, dense IDs in order of first use, so text can be written to content streams
 * before the final subset is known.
 */
export class EmbeddedFont {
  readonly font: FontProgram;
  /** Original glyph ID of each subset glyph; index is the ID used in content streams. */
  readonly #glyphs: number[] = [0];
  readonly #subsetId: Map<number, number> = new Map([[0, 0]]);
  /** The text each subset glyph stands for, for copy and search. */
  readonly #unicode: Map<number, string> = new Map();

  constructor(font: FontProgram) {
    if (!font.embeddable) {
      throw new Error(`${font.postScriptName} does not permit embedding (OS/2 fsType)`);
    }
    this.font = font;
  }

  /** The ID to use in content streams for one of the font's glyphs. */
  use(glyph: number, text?: string): number {
    let id = this.#subsetId.get(glyph);
    if (id === undefined) {
      id = this.#glyphs.length;
      if (id > 0xffff) throw new Error("A document can use at most 65535 glyphs of one font");
      this.#glyphs.push(glyph);
      this.#subsetId.set(glyph, id);
    }
    if (text !== undefined && !this.#unicode.has(id)) this.#unicode.set(id, text);
    return id;
  }

  /** Converts text to glyph IDs, one per character. Throws on a character the font lacks. */
  encode(text: string): PdfString {
    const out = new Uint8Array(text.length * 2);
    let length = 0;
    for (const char of text) {
      const codePoint = char.codePointAt(0) as number;
      const glyph = this.font.glyphForCodePoint(codePoint);
      if (glyph === 0) {
        throw new RangeError(
          `${this.font.postScriptName} has no glyph for "${char}" (U+${hex4(codePoint)})`,
        );
      }
      const id = this.use(glyph, char);
      out[length++] = id >> 8;
      out[length++] = id & 0xff;
    }
    return new PdfString(out.subarray(0, length), true);
  }

  /** Writes the font objects. `ref` is the reference pages already point at. */
  write(writer: PdfWriter, ref: PdfRef): void {
    const font = this.font;
    const subset = font.subset(this.#glyphs);
    const scale = 1000 / font.unitsPerEm;
    const scaled = (value: number): number => Math.round(value * scale);

    // Subset fonts carry a six-letter tag (ISO 32000-1, 9.6.4); derive it from the content so
    // that it is stable.
    const hash = new Hash128();
    hash.update(subset.data);
    const tag = Array.from(hash.digest().subarray(0, 6), (byte) =>
      String.fromCharCode(65 + (byte % 26)),
    ).join("");
    const baseFont = new PdfName(`${tag}+${font.postScriptName}`);

    const file = writer.add(
      new PdfStream(subset.data, new PdfDict({ Length1: subset.data.length })),
    );

    // Flags (table 123): 1 fixed pitch, 32 nonsymbolic, 64 italic.
    const flags = 32 | (font.isFixedPitch ? 1 : 0) | (font.isItalic ? 64 : 0);
    const descriptor = writer.add(
      new PdfDict({
        Type: new PdfName("FontDescriptor"),
        FontName: baseFont,
        Flags: flags,
        FontBBox: font.bbox.map(scaled),
        ItalicAngle: font.italicAngle,
        Ascent: scaled(font.ascender),
        Descent: scaled(font.descender),
        CapHeight: scaled(font.capHeight),
        // Not stored in TrueType fonts; this estimate from the weight is the usual practice.
        StemV: Math.round(50 + (font.weightClass / 65) ** 2),
        FontFile2: file,
      }),
    );

    const widths = subset.glyphs.map(
      (glyph) => Math.round(font.advanceWidth(glyph) * scale * 1000) / 1000,
    );
    const descendant = writer.add(
      new PdfDict({
        Type: new PdfName("Font"),
        Subtype: new PdfName("CIDFontType2"),
        BaseFont: baseFont,
        CIDSystemInfo: new PdfDict({
          Registry: PdfString.text("Adobe"),
          Ordering: PdfString.text("Identity"),
          Supplement: 0,
        }),
        FontDescriptor: descriptor,
        DW: widths[0] ?? 0,
        W: [0, widths],
        CIDToGIDMap: new PdfName("Identity"),
      }),
    );

    writer.set(
      ref,
      new PdfDict({
        Type: new PdfName("Font"),
        Subtype: new PdfName("Type0"),
        BaseFont: baseFont,
        Encoding: new PdfName("Identity-H"),
        DescendantFonts: [descendant],
        ToUnicode: writer.add(new PdfStream(this.#toUnicode())),
      }),
    );
  }

  /** The CMap that maps glyph IDs back to text (ISO 32000-1, 9.10.3). */
  #toUnicode(): Uint8Array {
    const out = new ByteWriter();
    out.ascii(
      "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n" +
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
        "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n" +
        "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n",
    );
    const entries = [...this.#unicode].sort((a, b) => a[0] - b[0]);
    for (let start = 0; start < entries.length; start += 100) {
      const chunk = entries.slice(start, start + 100);
      out.ascii(`${chunk.length} beginbfchar\n`);
      for (const [id, text] of chunk) out.ascii(`<${hex4(id)}> <${utf16Hex(text)}>\n`);
      out.ascii("endbfchar\n");
    }
    out.ascii("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
    return out.toBytes();
  }
}
