import { ByteWriter } from "./bytes.ts";
import { type PositionedGlyph, writeGlyphRun } from "./glyph-run.ts";
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
  /**
   * Shapes text into positioned glyphs (ligatures, kerning, accents), in font units. When a
   * font does not provide this, each character is drawn with its own glyph at its plain width.
   */
  shape?(text: string): readonly PositionedGlyph[];
  /** A font file with only these glyphs, renumbered in order; see `Font.subset`. */
  subset(glyphs: readonly number[]): {
    readonly data: Uint8Array;
    readonly glyphs: readonly number[];
    /** `"cff"` when `data` is a bare CID-keyed CFF table instead of a TrueType file. */
    readonly format?: "truetype" | "cff";
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
  /** Subset ID by glyph and the text it stands for. */
  readonly #subsetId: Map<string, number> = new Map();
  /** The text each subset glyph stands for, for copy and search. */
  readonly #unicode: Map<number, string> = new Map();

  constructor(font: FontProgram) {
    if (!font.embeddable) {
      throw new Error(`${font.postScriptName} does not permit embedding (OS/2 fsType)`);
    }
    this.font = font;
  }

  /**
   * The ID to use in content streams for one of the font's glyphs.
   *
   * A PDF maps each glyph ID to one piece of text. When the same glyph stands for different
   * text in different places (a programming ligature's spacer, an accent that is sometimes
   * part of a larger cluster), it gets one ID per text, so copy and search stay correct.
   *
   * @param text what the glyph stands for; omit for a glyph that adds no text of its own
   */
  use(glyph: number, text?: string): number {
    const key = text === undefined ? `${glyph}` : `${glyph}:${text}`;
    let id = this.#subsetId.get(key);
    if (id === undefined) {
      id = this.#glyphs.length;
      if (id > 0xffff) throw new Error("A document can use at most 65535 glyphs of one font");
      this.#glyphs.push(glyph);
      this.#subsetId.set(key, id);
      if (text !== undefined) this.#unicode.set(id, text);
    }
    return id;
  }

  /** One glyph per character at its plain advance, for fonts without a shaper. */
  #unshaped(text: string): PositionedGlyph[] {
    const glyphs: PositionedGlyph[] = [];
    for (let i = 0; i < text.length; ) {
      const codePoint = text.codePointAt(i) as number;
      const id = this.font.glyphForCodePoint(codePoint);
      glyphs.push({ id, cluster: i, xAdvance: this.font.advanceWidth(id), xOffset: 0, yOffset: 0 });
      i += codePoint > 0xffff ? 2 : 1;
    }
    return glyphs;
  }

  /**
   * Shows text. The font's shaper decides the glyphs; a character the font lacks is an error,
   * naming the font and the character.
   */
  show(out: ByteWriter, text: string, size: number, rise: number): void {
    const font = this.font;
    const glyphs = font.shape ? font.shape(text) : this.#unshaped(text);
    for (const glyph of glyphs) {
      if (glyph.id !== 0) continue;
      const codePoint = text.codePointAt(glyph.cluster) as number;
      throw new RangeError(
        `${font.postScriptName} has no glyph for "${String.fromCodePoint(codePoint)}" (U+${hex4(codePoint)})`,
      );
    }
    this.showGlyphs(out, glyphs, text, size, rise);
  }

  /**
   * Shows glyphs that are already shaped and positioned. `text` is what they stand for; glyph
   * clusters index into it. Glyph 0 is drawn as the font's "missing" box.
   */
  showGlyphs(
    out: ByteWriter,
    glyphs: readonly PositionedGlyph[],
    text: string,
    size: number,
    rise: number,
  ): void {
    writeGlyphRun(
      out,
      {
        unitsPerEm: this.font.unitsPerEm,
        bytesPerGlyph: 2,
        code: (glyph, clusterText) => this.use(glyph, clusterText),
        width: (glyph) => this.#pdfWidth(glyph),
      },
      glyphs,
      text,
      size,
      rise,
    );
  }

  /** A glyph's advance as written to the PDF: thousandths of the font size, 3 decimals. */
  #pdfWidth(glyph: number): number {
    return (
      Math.round(((this.font.advanceWidth(glyph) * 1000) / this.font.unitsPerEm) * 1000) / 1000
    );
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

    const cff = subset.format === "cff";
    const file = writer.add(
      new PdfStream(
        subset.data,
        new PdfDict(
          cff ? { Subtype: new PdfName("CIDFontType0C") } : { Length1: subset.data.length },
        ),
      ),
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
        FontFile2: cff ? undefined : file,
        FontFile3: cff ? file : undefined,
      }),
    );

    const widths = subset.glyphs.map((glyph) => this.#pdfWidth(glyph));
    const descendant = writer.add(
      new PdfDict({
        Type: new PdfName("Font"),
        Subtype: new PdfName(cff ? "CIDFontType0" : "CIDFontType2"),
        BaseFont: baseFont,
        CIDSystemInfo: new PdfDict({
          Registry: PdfString.text("Adobe"),
          Ordering: PdfString.text("Identity"),
          Supplement: 0,
        }),
        FontDescriptor: descriptor,
        DW: widths[0] ?? 0,
        W: [0, widths],
        // A TrueType font maps CIDs to glyphs here; a CFF font does it in its own charset.
        CIDToGIDMap: cff ? undefined : new PdfName("Identity"),
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
