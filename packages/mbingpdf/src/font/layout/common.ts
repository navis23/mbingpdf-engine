/**
 * Structures shared by the OpenType layout tables GSUB, GPOS and GDEF (OpenType spec, "OpenType
 * Layout Common Table Formats"). Everything is read straight from the table bytes on demand.
 */
import { BinaryReader } from "../reader.ts";
import { ItemVariationStore } from "../variations.ts";

/** Index of a glyph in a Coverage table, or -1 when it is not covered. */
export function coverageIndex(r: BinaryReader, offset: number, glyph: number): number {
  const format = r.u16At(offset);
  const count = r.u16At(offset + 2);
  let low = 0;
  let high = count - 1;
  if (format === 1) {
    while (low <= high) {
      const mid = (low + high) >> 1;
      const value = r.u16At(offset + 4 + mid * 2);
      if (value === glyph) return mid;
      if (value < glyph) low = mid + 1;
      else high = mid - 1;
    }
    return -1;
  }
  if (format === 2) {
    while (low <= high) {
      const mid = (low + high) >> 1;
      const at = offset + 4 + mid * 6;
      if (glyph < r.u16At(at)) high = mid - 1;
      else if (glyph > r.u16At(at + 2)) low = mid + 1;
      else return r.u16At(at + 4) + glyph - r.u16At(at);
    }
  }
  return -1;
}

/** Class of a glyph in a ClassDef table; 0 when the glyph is not listed. */
export function classOf(r: BinaryReader, offset: number, glyph: number): number {
  const format = r.u16At(offset);
  if (format === 1) {
    const start = r.u16At(offset + 2);
    const count = r.u16At(offset + 4);
    return glyph >= start && glyph < start + count ? r.u16At(offset + 6 + (glyph - start) * 2) : 0;
  }
  if (format === 2) {
    let low = 0;
    let high = r.u16At(offset + 2) - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const at = offset + 4 + mid * 6;
      if (glyph < r.u16At(at)) high = mid - 1;
      else if (glyph > r.u16At(at + 2)) low = mid + 1;
      else return r.u16At(at + 4);
    }
  }
  return 0;
}

/** Adds every glyph of a Coverage table to a set. */
function collectCoverage(r: BinaryReader, offset: number, into: Set<number>): void {
  const format = r.u16At(offset);
  const count = r.u16At(offset + 2);
  if (format === 1) {
    for (let i = 0; i < count; i++) into.add(r.u16At(offset + 4 + i * 2));
  } else if (format === 2) {
    for (let i = 0; i < count; i++) {
      const at = offset + 4 + i * 6;
      const end = r.u16At(at + 2);
      for (let glyph = r.u16At(at); glyph <= end; glyph++) into.add(glyph);
    }
  }
}

export const GLYPH_CLASS_BASE = 1;
export const GLYPH_CLASS_LIGATURE = 2;
export const GLYPH_CLASS_MARK = 3;

// Lookup flags.
export const IGNORE_BASE_GLYPHS = 0x0002;
export const IGNORE_LIGATURES = 0x0004;
export const IGNORE_MARKS = 0x0008;
export const USE_MARK_FILTERING_SET = 0x0010;
export const MARK_ATTACHMENT_TYPE_MASK = 0xff00;

/** The glyph definition table: which glyphs are bases, ligatures and marks. */
export class Gdef {
  readonly #r: BinaryReader;
  readonly #classDef: number;
  readonly #markAttachClassDef: number;
  readonly #markGlyphSets: number;
  /** Deltas for positioning values at the font's axis coordinates, if it is an instance. */
  readonly variations: ItemVariationStore | undefined;

  constructor(table: Uint8Array, coords?: readonly number[]) {
    const r = new BinaryReader(table);
    this.#r = r;
    const minor = r.u16At(2);
    this.#classDef = r.u16At(4);
    this.#markAttachClassDef = r.u16At(10);
    this.#markGlyphSets = minor >= 2 ? r.u16At(12) : 0;
    const store = minor >= 3 && table.length >= 18 ? r.u32At(14) : 0;
    this.variations =
      coords && store !== 0 ? new ItemVariationStore(table, store, coords) : undefined;
  }

  glyphClass(glyph: number): number {
    return this.#classDef === 0 ? 0 : classOf(this.#r, this.#classDef, glyph);
  }

  markAttachClass(glyph: number): number {
    return this.#markAttachClassDef === 0 ? 0 : classOf(this.#r, this.#markAttachClassDef, glyph);
  }

  inMarkSet(set: number, glyph: number): boolean {
    const base = this.#markGlyphSets;
    if (base === 0 || set >= this.#r.u16At(base + 2)) return false;
    return coverageIndex(this.#r, base + this.#r.u32At(base + 4 + set * 4), glyph) >= 0;
  }
}

export interface Lookup {
  readonly type: number;
  readonly flag: number;
  readonly markFilteringSet: number;
  /** Absolute offsets of the subtables, with extension subtables already resolved. */
  readonly subtables: readonly number[];
  /**
   * The glyphs at which any of the subtables can apply. Checking this first spares the far
   * costlier walk through the subtables for the many glyphs a lookup has nothing to do with.
   */
  readonly starts: ReadonlySet<number>;
}

/** A lookup to run, with the value of the feature that switched it on. */
export interface LookupSelection {
  readonly index: number;
  readonly value: number;
}

/** The script, feature and lookup lists that GSUB and GPOS have in common. */
export class LayoutTable {
  readonly r: BinaryReader;
  readonly #scriptList: number;
  readonly #featureList: number;
  readonly #lookupList: number;
  readonly #extensionType: number;
  readonly #lookups: Map<number, Lookup> = new Map();
  readonly #variations: ItemVariationStore | undefined;
  /** Feature index → offset of the feature table that replaces it at these coordinates. */
  readonly #substitutedFeatures: Map<number, number> = new Map();

  /**
   * @param extensionType the lookup type that wraps another lookup: 7 in GSUB, 9 in GPOS
   * @param coords normalised axis coordinates, for an instance of a variable font
   * @param variations the delta store from GDEF, for an instance of a variable font
   */
  constructor(
    table: Uint8Array,
    extensionType: number,
    coords?: readonly number[],
    variations?: ItemVariationStore,
  ) {
    const r = new BinaryReader(table);
    this.r = r;
    this.#scriptList = r.u16At(4);
    this.#featureList = r.u16At(6);
    this.#lookupList = r.u16At(8);
    this.#extensionType = extensionType;
    this.#variations = variations;

    // FeatureVariations: some features use different lookups in part of the design space
    // (for instance a simpler dollar sign in bold weights).
    const featureVariations = r.u16At(2) >= 1 && table.length >= 14 ? r.u32At(10) : 0;
    if (coords && featureVariations !== 0) {
      const count = r.u32At(featureVariations + 4);
      for (let i = 0; i < count; i++) {
        const record = featureVariations + 8 + i * 8;
        const conditionSet = r.u32At(record);
        let matches = true;
        if (conditionSet !== 0) {
          const set = featureVariations + conditionSet;
          for (let c = 0; c < r.u16At(set) && matches; c++) {
            const condition = set + r.u32At(set + 2 + c * 4);
            if (r.u16At(condition) !== 1) {
              matches = false;
              break;
            }
            const value = coords[r.u16At(condition + 2)] ?? 0;
            matches =
              value >= r.i16At(condition + 4) / 16384 && value <= r.i16At(condition + 6) / 16384;
          }
        }
        if (!matches) continue;
        const substitution = featureVariations + r.u32At(record + 4);
        for (let s = 0; s < r.u16At(substitution + 4); s++) {
          const entry = substitution + 6 + s * 6;
          this.#substitutedFeatures.set(r.u16At(entry), substitution + r.u32At(entry + 2));
        }
        break;
      }
    }
  }

  /**
   * The adjustment a Device table adds to a positioning value. Only variation deltas are
   * applied; pixel-size hinting deltas are meaningless in a PDF. The result is not rounded.
   */
  deviceDelta(base: number, offset: number): number {
    if (offset === 0 || !this.#variations) return 0;
    const at = base + offset;
    if (this.r.u16At(at + 4) !== 0x8000) return 0;
    return this.#variations.delta(this.r.u16At(at), this.r.u16At(at + 2));
  }

  /** Offset of the language system to use, or 0 when the table has no usable script. */
  #langSys(scripts: readonly string[], language: string | undefined): number {
    const r = this.r;
    const list = this.#scriptList;
    const count = r.u16At(list);
    for (const wanted of scripts) {
      for (let i = 0; i < count; i++) {
        const at = list + 2 + i * 6;
        if (r.seek(at).tag() !== wanted) continue;
        const script = list + r.u16At(at + 4);
        if (language !== undefined) {
          const languages = r.u16At(script + 2);
          for (let j = 0; j < languages; j++) {
            const record = script + 4 + j * 6;
            if (r.seek(record).tag() === language) return script + r.u16At(record + 4);
          }
        }
        const fallback = r.u16At(script);
        if (fallback !== 0) return script + fallback;
      }
    }
    return 0;
  }

  /** Whether the chosen script has a feature with this tag. */
  hasFeature(scripts: readonly string[], language: string | undefined, tag: string): boolean {
    return this.selectLookups(scripts, language, new Map([[tag, 1]])).length > 0;
  }

  /** The lookups that the given features switch on, in the order they must run. */
  selectLookups(
    scripts: readonly string[],
    language: string | undefined,
    features: ReadonlyMap<string, number>,
  ): LookupSelection[] {
    const r = this.r;
    const langSys = this.#langSys(scripts, language);
    if (langSys === 0) return [];
    const selected = new Map<number, number>();
    const addFeature = (featureIndex: number, value: number): void => {
      const feature =
        this.#substitutedFeatures.get(featureIndex) ??
        this.#featureList + r.u16At(this.#featureList + 2 + featureIndex * 6 + 4);
      const count = r.u16At(feature + 2);
      for (let i = 0; i < count; i++) {
        const lookup = r.u16At(feature + 4 + i * 2);
        if (!selected.has(lookup)) selected.set(lookup, value);
      }
    };
    const requiredFeature = r.u16At(langSys + 2);
    if (requiredFeature !== 0xffff) addFeature(requiredFeature, 1);
    const count = r.u16At(langSys + 4);
    for (let i = 0; i < count; i++) {
      const featureIndex = r.u16At(langSys + 6 + i * 2);
      const tag = r.seek(this.#featureList + 2 + featureIndex * 6).tag();
      const value = features.get(tag);
      if (value !== undefined && value !== 0) addFeature(featureIndex, value);
    }
    return [...selected].sort((a, b) => a[0] - b[0]).map(([index, value]) => ({ index, value }));
  }

  lookup(index: number): Lookup | undefined {
    let lookup = this.#lookups.get(index);
    if (lookup) return lookup;
    const r = this.r;
    const list = this.#lookupList;
    if (index >= r.u16At(list)) return undefined;
    const base = list + r.u16At(list + 2 + index * 2);
    let type = r.u16At(base);
    const flag = r.u16At(base + 2);
    const count = r.u16At(base + 4);
    const subtables: number[] = [];
    for (let i = 0; i < count; i++) {
      let subtable = base + r.u16At(base + 6 + i * 2);
      if (r.u16At(base) === this.#extensionType) {
        type = r.u16At(subtable + 2);
        subtable += r.u32At(subtable + 4);
      }
      subtables.push(subtable);
    }
    const markFilteringSet = flag & USE_MARK_FILTERING_SET ? r.u16At(base + 6 + count * 2) : 0;
    // Every subtable starts from a Coverage table for its first glyph. Contextual lookups in
    // their coverage-based format keep it after the backtrack sequence instead of up front.
    const starts = new Set<number>();
    const context = this.#extensionType === 7 ? 5 : 7;
    for (const subtable of subtables) {
      let coverage = subtable + 2;
      if ((type === context || type === context + 1) && r.u16At(subtable) === 3) {
        if (type === context) coverage = subtable + 6;
        else coverage = subtable + 4 + r.u16At(subtable + 2) * 2 + 2;
      }
      collectCoverage(r, subtable + r.u16At(coverage), starts);
    }
    lookup = { type, flag, markFilteringSet, subtables, starts };
    this.#lookups.set(index, lookup);
    return lookup;
  }
}
