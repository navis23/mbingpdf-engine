/**
 * Text shaping: turning characters into positioned glyphs.
 *
 * The built-in shaper covers scripts that need only substitution and positioning in logical
 * order: Latin, Greek, Cyrillic and the like. It applies the font's GSUB and GPOS tables
 * (ligatures, contextual alternates, kerning, mark attachment). Scripts that need reordering or
 * joining logic (Arabic, Indic, Thai, …) need a different {@link Shaper}, such as HarfBuzz.
 */
import { type BufferGlyph, newGlyph, ShapingBuffer } from "./layout/buffer.ts";
import { Gdef, GLYPH_CLASS_MARK, LayoutTable } from "./layout/common.ts";
import { applyGposLookup, resolveAttachments } from "./layout/gpos.ts";
import { applyGsubLookup } from "./layout/gsub.ts";
import { BinaryReader } from "./reader.ts";

/** A glyph placed by the shaper. All distances are in font units. */
export interface ShapedGlyph {
  /** Glyph ID in the font. 0 means the font has no glyph for the character. */
  readonly id: number;
  /** UTF-16 offset in the input of the first character this glyph stands for. */
  readonly cluster: number;
  /** How far the pen moves after this glyph. */
  readonly xAdvance: number;
  readonly yAdvance: number;
  /** Where to draw the glyph relative to the pen. */
  readonly xOffset: number;
  readonly yOffset: number;
}

export interface ShapeOptions {
  /**
   * OpenType features to switch on or off, by four-letter tag: `{ liga: false, tnum: true }`.
   * A number selects an alternate for features that offer several (`{ salt: 2 }`).
   */
  readonly features?: Readonly<Record<string, boolean | number>>;
  /** OpenType script tag such as `latn`. Guessed from the text when omitted. */
  readonly script?: string;
  /** OpenType language tag such as `TRK ` (four characters, space-padded). */
  readonly language?: string;
}

/** What a shaper needs from a font. `TrueTypeFont` satisfies it. */
export interface ShapableFont {
  table(tag: string): Uint8Array | undefined;
  glyphForCodePoint(codePoint: number): number;
  advanceWidth(glyph: number): number;
}

export interface Shaper {
  shape(font: ShapableFont, text: string, options?: ShapeOptions): ShapedGlyph[];
}

/** Features that are on unless switched off, as in browsers and HarfBuzz. */
const DEFAULT_GSUB = ["ccmp", "locl", "rlig", "liga", "clig", "calt", "rclt"];
const DEFAULT_GPOS = ["kern", "mark", "mkmk", "abvm", "blwm", "dist"];

interface LayoutData {
  gdef: Gdef | undefined;
  gsub: LayoutTable | undefined;
  gpos: LayoutTable | undefined;
  kern: Map<number, number> | undefined | null;
}

const layoutCache: WeakMap<ShapableFont, LayoutData> = new WeakMap();

function layoutData(font: ShapableFont): LayoutData {
  let data = layoutCache.get(font);
  if (!data) {
    const gdef = font.table("GDEF");
    const gsub = font.table("GSUB");
    const gpos = font.table("GPOS");
    data = {
      gdef: gdef && gdef.length >= 12 ? new Gdef(gdef) : undefined,
      gsub: gsub && gsub.length >= 10 ? new LayoutTable(gsub, 7) : undefined,
      gpos: gpos && gpos.length >= 10 ? new LayoutTable(gpos, 9) : undefined,
      kern: null,
    };
    layoutCache.set(font, data);
  }
  return data;
}

/** Reads the horizontal pairs of a legacy `kern` table: (left << 16 | right) → adjustment. */
function legacyKerning(font: ShapableFont, data: LayoutData): Map<number, number> | undefined {
  if (data.kern !== null) return data.kern;
  data.kern = undefined;
  const table = font.table("kern");
  if (!table || table.length < 4) return undefined;
  const r = new BinaryReader(table);
  if (r.u16At(0) !== 0) return undefined;
  const pairs = new Map<number, number>();
  let at = 4;
  for (let i = 0; i < r.u16At(2) && at + 6 <= table.length; i++) {
    const length = r.u16At(at + 2);
    const coverage = r.u16At(at + 4);
    // Format 0, horizontal, not minimum, not cross-stream.
    if (coverage >> 8 === 0 && (coverage & 0x07) === 0x01) {
      const count = r.u16At(at + 6);
      for (let j = 0; j < count; j++) {
        const pair = at + 14 + j * 6;
        if (pair + 6 > table.length) break;
        const key = r.u32At(pair);
        pairs.set(key, (pairs.get(key) ?? 0) + r.i16At(pair + 4));
      }
    }
    if (length === 0) break;
    at += length;
  }
  data.kern = pairs.size > 0 ? pairs : undefined;
  return data.kern;
}

const MARK = /^\p{M}$/u;

/** Characters that take no space and draw nothing: joiners, variation selectors and so on. */
function isDefaultIgnorable(codePoint: number): boolean {
  return (
    codePoint === 0x00ad ||
    codePoint === 0x034f ||
    codePoint === 0x061c ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    codePoint === 0xfeff ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

/** Stand-ins for characters a font may lack but can be drawn with another glyph. */
const FALLBACKS: ReadonlyMap<number, readonly number[]> = new Map([
  [0x00a0, [0x0020]], // no-break space
  [0x202f, [0x0020]], // narrow no-break space
  [0x2011, [0x2010, 0x002d]], // non-breaking hyphen
  [0x2010, [0x002d]], // hyphen
]);

function guessScripts(text: string): string[] {
  for (const char of text) {
    const codePoint = char.codePointAt(0) as number;
    if (
      (codePoint >= 0x0370 && codePoint <= 0x03ff) ||
      (codePoint >= 0x1f00 && codePoint <= 0x1fff)
    ) {
      return ["grek", "DFLT", "dflt", "latn"];
    }
    if (codePoint >= 0x0400 && codePoint <= 0x052f) return ["cyrl", "DFLT", "dflt", "latn"];
    if (
      (codePoint >= 0x41 && codePoint <= 0x5a) ||
      (codePoint >= 0x61 && codePoint <= 0x7a) ||
      (codePoint >= 0xc0 && codePoint <= 0x24f) ||
      (codePoint >= 0x1e00 && codePoint <= 0x1eff)
    ) {
      return ["latn", "DFLT", "dflt"];
    }
  }
  return ["DFLT", "dflt", "latn"];
}

/** Maps characters to glyphs, composing or decomposing accents to fit what the font has. */
function mapCharacters(font: ShapableFont, text: string): BufferGlyph[] {
  const glyphs: BufferGlyph[] = [];
  let previousCodePoint = -1;
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i) as number;
    const char = String.fromCodePoint(codePoint);
    const cluster = i;
    i += char.length;
    if (isDefaultIgnorable(codePoint)) continue;

    const last = glyphs.at(-1);
    const isMark = MARK.test(char);
    if (isMark && last && previousCodePoint >= 0) {
      // "e" + combining acute becomes "é" when the font has that glyph.
      const composed = (String.fromCodePoint(previousCodePoint) + char).normalize("NFC");
      const composedCodePoint = composed.codePointAt(0) as number;
      if (composed.length === String.fromCodePoint(composedCodePoint).length) {
        const glyph = font.glyphForCodePoint(composedCodePoint);
        if (glyph !== 0) {
          last.id = glyph;
          previousCodePoint = composedCodePoint;
          continue;
        }
      }
    }

    let glyph = font.glyphForCodePoint(codePoint);
    if (glyph === 0) {
      // The reverse: "é" drawn as "e" plus an accent when the font only has the parts.
      const parts = [...char.normalize("NFD")].map((part) =>
        font.glyphForCodePoint(part.codePointAt(0) as number),
      );
      if (parts.length > 1 && parts.every((part) => part !== 0)) {
        for (const part of parts) glyphs.push(newGlyph(part, cluster));
        previousCodePoint = -1;
        continue;
      }
      for (const fallback of FALLBACKS.get(codePoint) ?? []) {
        glyph = font.glyphForCodePoint(fallback);
        if (glyph !== 0) break;
      }
    }
    // A combining mark belongs to the cluster of the letter it sits on.
    glyphs.push(newGlyph(glyph, isMark && last ? last.cluster : cluster));
    previousCodePoint = isMark ? -1 : codePoint;
  }
  return glyphs;
}

function featureMap(
  defaults: readonly string[],
  overrides: Readonly<Record<string, boolean | number>> | undefined,
): Map<string, number> {
  const features = new Map<string, number>(defaults.map((tag) => [tag, 1]));
  for (const [tag, value] of Object.entries(overrides ?? {})) {
    features.set(tag, value === true ? 1 : value === false ? 0 : value);
  }
  return features;
}

/** The built-in shaper for simple scripts. */
export const openTypeShaper: Shaper = {
  shape(font, text, options = {}) {
    const data = layoutData(font);
    const buffer = new ShapingBuffer(mapCharacters(font, text), data.gdef);
    const scripts = options.script ? [options.script, "DFLT", "dflt"] : guessScripts(text);
    const language = options.language;

    if (data.gsub) {
      // Variation alternates run first and on their own, then everything else together.
      const stages = [new Map([["rvrn", 1]]), featureMap(DEFAULT_GSUB, options.features)];
      for (const features of stages) {
        for (const { index, value } of data.gsub.selectLookups(scripts, language, features)) {
          applyGsubLookup(data.gsub, buffer, index, value);
        }
      }
    }

    for (const glyph of buffer.glyphs) glyph.xAdvance = font.advanceWidth(glyph.id);

    const features = featureMap(DEFAULT_GPOS, options.features);
    if (data.gpos) {
      for (const { index } of data.gpos.selectLookups(scripts, language, features)) {
        applyGposLookup(data.gpos, buffer, index);
      }
    }
    if (features.get("kern") !== 0 && !data.gpos?.hasFeature(scripts, language, "kern")) {
      // Older fonts keep their kerning in the `kern` table instead of GPOS.
      const pairs = legacyKerning(font, data);
      if (pairs) {
        const glyphs = buffer.glyphs;
        for (let i = 0; i + 1 < glyphs.length; i++) {
          const left = glyphs[i] as BufferGlyph;
          const adjustment = pairs.get(((left.id << 16) | (glyphs[i + 1] as BufferGlyph).id) >>> 0);
          if (adjustment) left.xAdvance += adjustment;
        }
      }
    }

    // Marks sit on other glyphs and must not move the pen.
    if (data.gdef) {
      for (const glyph of buffer.glyphs) {
        if (data.gdef.glyphClass(glyph.id) === GLYPH_CLASS_MARK) {
          glyph.xAdvance = 0;
          glyph.yAdvance = 0;
        }
      }
    }
    resolveAttachments(buffer);

    return buffer.glyphs.map((glyph) => ({
      id: glyph.id,
      cluster: glyph.cluster,
      xAdvance: glyph.xAdvance,
      yAdvance: glyph.yAdvance,
      xOffset: glyph.xOffset,
      yOffset: glyph.yOffset,
    }));
  },
};
