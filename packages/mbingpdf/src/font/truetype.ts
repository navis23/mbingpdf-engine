import {
  ARG_1_AND_2_ARE_WORDS,
  decodeGlyph,
  encodeCompositeGlyph,
  encodeSimpleGlyph,
  MORE_COMPONENTS,
  WE_HAVE_A_SCALE,
  WE_HAVE_A_TWO_BY_TWO,
  WE_HAVE_AN_X_AND_Y_SCALE,
} from "./glyf.ts";
import { applyDeltas, GlyphVariations } from "./gvar.ts";
import { BinaryReader, BinaryWriter } from "./reader.ts";
import { buildSfnt, parseSfnt } from "./sfnt.ts";
import { openTypeShaper, type ShapedGlyph, type ShapeOptions, type Shaper } from "./shaper.ts";
import {
  AdvanceVariations,
  metricDeltas,
  type NamedInstance,
  normalizeCoordinates,
  parseFvar,
  roundDelta,
  type VariationAxis,
} from "./variations.ts";

/** The result of {@link TrueTypeFont.subset}. */
export interface FontSubset {
  /** A font file holding only the requested glyphs, renumbered from zero. */
  readonly data: Uint8Array;
  /**
   * Original glyph ID of each glyph in the subset. It starts with the requested glyphs in the
   * order given; parts of composite glyphs that were not requested follow.
   */
  readonly glyphs: readonly number[];
}

function required(tables: ReadonlyMap<string, Uint8Array>, tag: string): Uint8Array {
  const table = tables.get(tag);
  if (!table) throw new Error(`Font has no ${tag} table`);
  return table;
}

function decodeName(bytes: Uint8Array, platform: number): string {
  if (platform === 1) return String.fromCharCode(...bytes);
  let text = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode(((bytes[i] as number) << 8) | (bytes[i + 1] as number));
  }
  return text;
}

function parseNames(table: Uint8Array | undefined): Map<number, string> {
  const names = new Map<number, string>();
  if (!table) return names;
  const reader = new BinaryReader(table);
  reader.skip(2);
  const count = reader.u16();
  const storage = reader.u16();
  const rank = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const platform = reader.u16();
    reader.skip(2);
    const language = reader.u16();
    const id = reader.u16();
    const length = reader.u16();
    const offset = reader.u16();
    // Prefer Windows US English, then any Unicode or Windows record, then Macintosh Roman.
    let score = 0;
    if (platform === 3 && language === 0x0409) score = 4;
    else if (platform === 0) score = 3;
    else if (platform === 3) score = 2;
    else if (platform === 1 && language === 0) score = 1;
    if (score > (rank.get(id) ?? 0)) {
      rank.set(id, score);
      names.set(
        id,
        decodeName(table.subarray(storage + offset, storage + offset + length), platform),
      );
    }
  }
  return names;
}

/** Reads the best Unicode character map into code point → glyph ID. */
function parseCmap(table: Uint8Array): Map<number, number> {
  const reader = new BinaryReader(table);
  reader.skip(2);
  const count = reader.u16();
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < count; i++) {
    const platform = reader.u16();
    const encoding = reader.u16();
    const offset = reader.u32();
    const format = reader.u16At(offset);
    let score = 0;
    if (format === 12 && ((platform === 3 && encoding === 10) || platform === 0)) score = 4;
    else if (format === 4 && platform === 3 && encoding === 1) score = 3;
    else if (format === 4 && platform === 0) score = 2;
    else if (format === 4 && platform === 3 && encoding === 0) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = offset;
    }
  }
  if (best < 0) throw new Error("Font has no Unicode character map (cmap format 4 or 12)");

  const map = new Map<number, number>();
  reader.seek(best);
  const format = reader.u16();
  if (format === 12) {
    reader.skip(10);
    const groups = reader.u32();
    for (let i = 0; i < groups; i++) {
      const start = reader.u32();
      const end = reader.u32();
      const glyph = reader.u32();
      for (let code = start; code <= end; code++) map.set(code, glyph + code - start);
    }
    return map;
  }
  reader.skip(4);
  const segments = reader.u16() / 2;
  reader.skip(6);
  const ends = reader.offset;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let i = 0; i < segments; i++) {
    const end = reader.u16At(ends + i * 2);
    const start = reader.u16At(starts + i * 2);
    const delta = reader.u16At(deltas + i * 2);
    const rangeOffset = reader.u16At(rangeOffsets + i * 2);
    for (let code = start; code <= end && code !== 0xffff; code++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const at = rangeOffsets + i * 2 + rangeOffset + (code - start) * 2;
        if (at + 2 > table.length) continue;
        glyph = reader.u16At(at);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) map.set(code, glyph);
    }
  }
  return map;
}

/**
 * A font with TrueType outlines (`.ttf`, or `.otf` with a `glyf` table).
 *
 * Parsing reads the tables needed for measuring and embedding; nothing is tied to a document,
 * so one instance can be shared. Metrics are in font units; divide by {@link unitsPerEm}.
 */
export class TrueTypeFont {
  readonly postScriptName: string;
  readonly familyName: string;
  readonly subfamilyName: string;
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly bbox: readonly [number, number, number, number];
  /** Degrees counter-clockwise from vertical; negative for fonts that lean right. */
  readonly italicAngle: number;
  readonly underlinePosition: number;
  readonly underlineThickness: number;
  readonly isFixedPitch: boolean;
  readonly isItalic: boolean;
  /** 100–900; 400 is regular and 700 bold. */
  readonly weightClass: number;
  /** False when the font's licence flags forbid embedding it in documents. */
  readonly embeddable: boolean;
  /**
   * Turns text into positioned glyphs. Replace it to use another shaping engine, for scripts
   * the built-in one does not cover.
   */
  shaper: Shaper = openTypeShaper;
  /** The design axes of a variable font; empty for a static font. */
  readonly axes: readonly VariationAxis[];
  /** The styles the designer named, such as "Bold" or "Light Condensed". */
  readonly namedInstances: readonly NamedInstance[];
  /**
   * Normalised axis coordinates of this instance, for shapers. Undefined for a static font and
   * for a variable font at its default position.
   */
  readonly variationCoords: readonly number[] | undefined;

  readonly #data: Uint8Array;
  readonly #advances: AdvanceVariations | undefined;
  readonly #outlines: GlyphVariations | undefined;
  readonly #instanced: Map<number, { data: Uint8Array; xMin: number; advance: number }> = new Map();
  readonly #tables: ReadonlyMap<string, Uint8Array>;
  readonly #cmap: Map<number, number>;
  readonly #hmtx: BinaryReader;
  readonly #numberOfHMetrics: number;
  readonly #loca: BinaryReader;
  readonly #longLoca: boolean;
  readonly #glyf: Uint8Array;

  /**
   * @param data the font file
   * @param variation for a variable font, axis values such as `{ wght: 700 }`; prefer
   *   {@link TrueTypeFont.instance}, which also accepts a named style
   */
  constructor(data: Uint8Array, variation?: Readonly<Record<string, number>>) {
    this.#data = data;
    const sfnt = parseSfnt(data);
    if (sfnt.flavor !== "truetype") {
      throw new Error("Fonts with CFF outlines (most .otf files) are not supported yet");
    }
    const tables = sfnt.tables;
    this.#tables = tables;

    const head = new BinaryReader(required(tables, "head"));
    this.unitsPerEm = head.u16At(18);
    this.bbox = [head.i16At(36), head.i16At(38), head.i16At(40), head.i16At(42)];
    const macStyle = head.u16At(44);
    this.#longLoca = head.i16At(50) === 1;

    const hhea = new BinaryReader(required(tables, "hhea"));
    this.#numberOfHMetrics = hhea.u16At(34);
    this.numGlyphs = new BinaryReader(required(tables, "maxp")).u16At(4);
    this.#hmtx = new BinaryReader(required(tables, "hmtx"));
    this.#loca = new BinaryReader(required(tables, "loca"));
    this.#glyf = required(tables, "glyf");
    this.#cmap = parseCmap(required(tables, "cmap"));

    let ascender = hhea.i16At(4);
    let descender = hhea.i16At(6);
    let lineGap = hhea.i16At(8);
    let capHeight = 0;
    let xHeight = 0;
    let weightClass = macStyle & 1 ? 700 : 400;
    let italic = (macStyle & 2) !== 0;
    let embeddable = true;
    const os2Table = tables.get("OS/2");
    if (os2Table && os2Table.length >= 78) {
      const os2 = new BinaryReader(os2Table);
      weightClass = os2.u16At(4);
      // fsType: bit 1 is "restricted licence"; bit 9 is "bitmap embedding only".
      const fsType = os2.u16At(8);
      embeddable = (fsType & 0x0002) === 0 && (fsType & 0x0200) === 0;
      const fsSelection = os2.u16At(62);
      italic = italic || (fsSelection & 0x01) !== 0;
      if (fsSelection & 0x80) {
        // USE_TYPO_METRICS: the font asks for its typographic metrics to set line spacing.
        ascender = os2.i16At(68);
        descender = os2.i16At(70);
        lineGap = os2.i16At(72);
      }
      if (os2.u16At(0) >= 2 && os2Table.length >= 90) {
        xHeight = os2.i16At(86);
        capHeight = os2.i16At(88);
      }
    }
    const names = parseNames(tables.get("name"));
    const fvar = parseFvar(tables.get("fvar"), names);
    this.axes = fvar.axes;
    this.namedInstances = fvar.instances;
    let coords: number[] | undefined;
    if (variation && fvar.axes.length > 0) {
      for (const tag of Object.keys(variation)) {
        if (!fvar.axes.some((axis) => axis.tag === tag)) {
          const known = fvar.axes.map((axis) => axis.tag).join(", ");
          throw new RangeError(`Font has no "${tag}" axis; it has ${known}`);
        }
      }
      coords = normalizeCoordinates(fvar.axes, tables.get("avar"), variation);
      if (coords.every((value) => value === 0)) coords = undefined;
    } else if (variation && Object.keys(variation).length > 0) {
      throw new RangeError("This is not a variable font, so it has no axes to set");
    }
    this.variationCoords = coords;
    let underlineOffsetDelta = 0;
    let underlineSizeDelta = 0;
    if (coords) {
      const hvar = tables.get("HVAR");
      const gvar = tables.get("gvar");
      this.#advances = hvar && hvar.length >= 12 ? new AdvanceVariations(hvar, coords) : undefined;
      this.#outlines = gvar && gvar.length >= 20 ? new GlyphVariations(gvar, coords) : undefined;
      const metrics = metricDeltas(tables.get("MVAR"), coords);
      ascender += roundDelta(metrics.get("hasc") ?? 0);
      descender += roundDelta(metrics.get("hdsc") ?? 0);
      lineGap += roundDelta(metrics.get("hlgp") ?? 0);
      if (capHeight) capHeight += roundDelta(metrics.get("cpht") ?? 0);
      if (xHeight) xHeight += roundDelta(metrics.get("xhgt") ?? 0);
      underlineOffsetDelta = roundDelta(metrics.get("undo") ?? 0);
      underlineSizeDelta = roundDelta(metrics.get("unds") ?? 0);
      const weight = variation?.wght;
      if (weight !== undefined) weightClass = Math.round(Math.min(Math.max(weight, 1), 1000));
    }
    this.ascender = ascender;
    this.descender = descender;
    this.lineGap = lineGap;
    this.capHeight = capHeight || Math.round(ascender * 0.72);
    this.xHeight = xHeight || Math.round(ascender * 0.5);
    this.weightClass = weightClass;
    this.isItalic = italic;
    this.embeddable = embeddable;

    const postTable = tables.get("post");
    const post = postTable && postTable.length >= 16 ? new BinaryReader(postTable) : undefined;
    this.italicAngle = post ? post.seek(4).fixed() : 0;
    this.underlinePosition =
      (post ? post.i16At(8) : Math.round(-this.unitsPerEm * 0.1)) + underlineOffsetDelta;
    this.underlineThickness =
      (post ? post.i16At(10) : Math.round(this.unitsPerEm * 0.05)) + underlineSizeDelta;
    this.isFixedPitch = post ? post.u32At(12) !== 0 : false;

    this.familyName = names.get(16) ?? names.get(1) ?? "Unknown";
    let subfamily = names.get(17) ?? names.get(2) ?? "Regular";
    let postScriptName = names.get(6) ?? `${this.familyName}-${subfamily}`;
    if (coords && variation) {
      // Name the instance after the designer's style when the coordinates match one.
      const full: Record<string, number> = {};
      for (const axis of fvar.axes) full[axis.tag] = variation[axis.tag] ?? axis.default;
      const named = fvar.instances.find((instance) =>
        fvar.axes.every((axis) => instance.coordinates[axis.tag] === full[axis.tag]),
      );
      const prefix = (names.get(25) ?? this.familyName).replace(/\s+/g, "");
      if (named) {
        subfamily = named.name;
        postScriptName = named.postScriptName ?? `${prefix}-${named.name}`;
      } else {
        const values = fvar.axes
          .filter((axis) => full[axis.tag] !== axis.default)
          .map((axis) => `${axis.tag}${Math.round((full[axis.tag] as number) * 100) / 100}`);
        subfamily = values.join(" ");
        postScriptName = `${prefix}-${values.join("")}`;
      }
    }
    this.subfamilyName = subfamily;
    // A PostScript name may not contain spaces or PDF delimiters.
    this.postScriptName = postScriptName.replace(/[^\x21-\x7e]|[()<>[\]{}/%]/g, "");
  }

  /**
   * A fixed style of a variable font: either axis values (`{ wght: 700 }`, unlisted axes stay
   * at their default) or the name of one of {@link namedInstances} (`"Bold"`). The result
   * behaves like a static font and embeds as one.
   */
  instance(style: Readonly<Record<string, number>> | string): TrueTypeFont {
    if (this.axes.length === 0) throw new RangeError("This is not a variable font");
    if (typeof style !== "string") return new TrueTypeFont(this.#data, style);
    const named = this.namedInstances.find(
      (instance) => instance.name.toLowerCase() === style.toLowerCase(),
    );
    if (!named) {
      const known = this.namedInstances.map((instance) => instance.name).join(", ");
      throw new RangeError(`Font has no style named "${style}"; it has ${known}`);
    }
    return new TrueTypeFont(this.#data, named.coordinates);
  }

  /** The raw bytes of a font table, such as `GSUB` or `kern`. */
  table(tag: string): Uint8Array | undefined {
    return this.#tables.get(tag);
  }

  /** The glyph for a Unicode code point, or 0 (the "missing glyph") when the font has none. */
  glyphForCodePoint(codePoint: number): number {
    return this.#cmap.get(codePoint) ?? 0;
  }

  /** Whether the font has a glyph for every character of `text`. */
  hasGlyphsFor(text: string): boolean {
    for (const char of text) {
      if (!this.#cmap.has(char.codePointAt(0) as number)) return false;
    }
    return true;
  }

  /** The advance width of a glyph in font units. */
  advanceWidth(glyph: number): number {
    if (glyph < 0 || glyph >= this.numGlyphs) return 0;
    const advance = this.#hmtx.u16At(Math.min(glyph, this.#numberOfHMetrics - 1) * 4);
    if (!this.variationCoords) return advance;
    if (this.#advances) return advance + roundDelta(this.#advances.delta(glyph));
    // Without HVAR the advance comes from the outline's phantom points.
    return this.#instancedGlyph(glyph).advance;
  }

  /**
   * Shapes text: maps characters to glyphs and applies the font's ligatures, kerning and
   * accent positioning. A glyph ID of 0 marks a character the font cannot show.
   */
  shape(text: string, options?: ShapeOptions): ShapedGlyph[] {
    return this.shaper.shape(this, text, options);
  }

  /** The width of `text` at `size` in points, after shaping. */
  widthOfText(text: string, size: number, options?: ShapeOptions): number {
    let total = 0;
    for (const glyph of this.shape(text, options)) total += glyph.xAdvance;
    return (total * size) / this.unitsPerEm;
  }

  /** Distance from the baseline to the top of the line at `size`. */
  ascent(size: number): number {
    return (this.ascender * size) / this.unitsPerEm;
  }

  /** Distance from the baseline to the bottom of the line at `size`, as a positive number. */
  descent(size: number): number {
    return (-this.descender * size) / this.unitsPerEm;
  }

  #leftSideBearing(glyph: number): number {
    const metrics = this.#numberOfHMetrics;
    if (glyph < metrics) return this.#hmtx.i16At(glyph * 4 + 2);
    return this.#hmtx.i16At(metrics * 4 + (glyph - metrics) * 2);
  }

  #glyphData(glyph: number): Uint8Array {
    if (glyph < 0 || glyph >= this.numGlyphs) return new Uint8Array(0);
    const start = this.#longLoca ? this.#loca.u32At(glyph * 4) : this.#loca.u16At(glyph * 2) * 2;
    const end = this.#longLoca
      ? this.#loca.u32At(glyph * 4 + 4)
      : this.#loca.u16At(glyph * 2 + 2) * 2;
    return this.#glyf.subarray(start, end);
  }

  /** A glyph's outline, left edge and advance at this instance's axis coordinates. */
  #instancedGlyph(glyph: number): { data: Uint8Array; xMin: number; advance: number } {
    let result = this.#instanced.get(glyph);
    if (result) return result;
    const source = this.#glyphData(glyph);
    const defaultAdvance = this.#hmtx.u16At(Math.min(glyph, this.#numberOfHMetrics - 1) * 4);
    result = {
      data: source,
      xMin: source.length >= 10 ? new BinaryReader(source).i16At(2) : 0,
      advance: defaultAdvance,
    };
    const decoded = decodeGlyph(source);
    // An empty glyph (a space) still has phantom points, so its advance can vary.
    const shape = decoded ?? {
      kind: "simple" as const,
      endPoints: [],
      x: [],
      y: [],
      onCurve: [],
      overlap: false,
    };
    const deltas = this.#outlines?.deltas(glyph, shape);
    if (deltas) {
      const points = shape.kind === "simple" ? shape.x.length : shape.components.length;
      const advance =
        defaultAdvance +
        roundDelta((deltas.x[points + 1] as number) - (deltas.x[points] as number));
      applyDeltas(shape, deltas);
      if (shape.kind === "simple") {
        const data = encodeSimpleGlyph(shape);
        result = { data, xMin: shape.x.length > 0 ? Math.min(...shape.x) : 0, advance };
      } else {
        result = { data: encodeCompositeGlyph(shape), xMin: result.xMin, advance };
      }
    } else if (decoded) {
      // Re-encode anyway: instances are written without hinting instructions.
      const data =
        decoded.kind === "simple" ? encodeSimpleGlyph(decoded) : encodeCompositeGlyph(decoded);
      result = { data, xMin: result.xMin, advance: defaultAdvance };
    }
    this.#instanced.set(glyph, result);
    return result;
  }

  /**
   * Builds a font containing only the given glyphs, renumbered in the order given. Glyph 0
   * must come first, and a glyph may be repeated. Glyphs that the requested ones are composed
   * of are added at the end.
   */
  subset(glyphs: readonly number[]): FontSubset {
    if (glyphs[0] !== 0) throw new Error("A subset must start with glyph 0");
    const order = [...glyphs];
    const newId = new Map<number, number>();
    // A glyph may be listed more than once; composites then refer to its first copy.
    order.forEach((glyph, i) => {
      if (!newId.has(glyph)) newId.set(glyph, i);
    });

    const glyf = new BinaryWriter();
    const offsets: number[] = [];
    // `order` grows while we walk it, as composite glyphs pull in their parts.
    for (let i = 0; i < order.length; i++) {
      offsets.push(glyf.length);
      const source = this.variationCoords
        ? this.#instancedGlyph(order[i] as number).data
        : this.#glyphData(order[i] as number);
      if (source.length === 0) continue;
      const data = source.slice();
      const reader = new BinaryReader(data);
      if (reader.i16At(0) < 0) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        let at = 10;
        let flags: number;
        do {
          flags = reader.u16At(at);
          const part = reader.u16At(at + 2);
          let id = newId.get(part);
          if (id === undefined) {
            id = order.length;
            order.push(part);
            newId.set(part, id);
          }
          view.setUint16(at + 2, id);
          at += 4 + (flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2);
          if (flags & WE_HAVE_A_SCALE) at += 2;
          else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) at += 4;
          else if (flags & WE_HAVE_A_TWO_BY_TWO) at += 8;
        } while (flags & MORE_COMPONENTS);
      }
      // Glyphs start on even offsets, which the compact form of `loca` requires.
      glyf.bytes(data).align(2);
    }
    offsets.push(glyf.length);
    const count = order.length;
    if (count > 0xffff) throw new Error("A subset cannot hold more than 65535 glyphs");

    // `loca` stores half-offsets in 16 bits when the glyph data is small enough.
    const shortLoca = glyf.length <= 0x1fffe;
    const loca = new BinaryWriter();
    for (const offset of offsets) {
      if (shortLoca) loca.u16(offset / 2);
      else loca.u32(offset);
    }

    const hmtx = new BinaryWriter();
    for (const glyph of order) {
      const bearing = this.variationCoords
        ? this.#instancedGlyph(glyph).xMin
        : this.#leftSideBearing(glyph);
      hmtx.u16(this.advanceWidth(glyph)).i16(bearing);
    }

    const head = required(this.#tables, "head").slice();
    const headView = new DataView(head.buffer);
    headView.setUint32(8, 0); // checkSumAdjustment, filled in by buildSfnt
    headView.setInt16(50, shortLoca ? 0 : 1); // indexToLocFormat

    const hhea = required(this.#tables, "hhea").slice();
    new DataView(hhea.buffer).setUint16(34, count);

    const maxp = required(this.#tables, "maxp").slice();
    new DataView(maxp.buffer).setUint16(4, count);

    const tables = new Map<string, Uint8Array>([
      ["glyf", glyf.toBytes()],
      ["head", head],
      ["hhea", hhea],
      ["hmtx", hmtx.toBytes()],
      ["loca", loca.toBytes()],
      ["maxp", maxp],
    ]);
    // Hinting programs: instructions inside glyphs refer to them. An instance of a variable
    // font is written unhinted, because its hinting would need the `cvar` deltas applied.
    if (!this.variationCoords) {
      for (const tag of ["cvt ", "fpgm", "prep"]) {
        const table = this.#tables.get(tag);
        if (table) tables.set(tag, table);
      }
    }
    return { data: buildSfnt(tables), glyphs: order };
  }
}
