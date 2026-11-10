import {
  type Gdef,
  GLYPH_CLASS_BASE,
  GLYPH_CLASS_LIGATURE,
  GLYPH_CLASS_MARK,
  IGNORE_BASE_GLYPHS,
  IGNORE_LIGATURES,
  IGNORE_MARKS,
  type Lookup,
  MARK_ATTACHMENT_TYPE_MASK,
  USE_MARK_FILTERING_SET,
} from "./common.ts";

/** A glyph while it is being shaped. Positions are in font units. */
export interface BufferGlyph {
  id: number;
  /** UTF-16 offset in the input text of the character(s) this glyph came from. */
  cluster: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  /** Identifies the ligature this glyph is, or (for a mark) the ligature it sits on. */
  ligatureId: number;
  /** For a mark on a ligature: which component it belongs to, counting from 1. */
  ligatureComponent: number;
  /** For a ligature: how many components it was formed from. */
  componentCount: number;
  /** Index of the glyph this mark is attached to, or -1. */
  attachedTo: number;
}

export function newGlyph(id: number, cluster: number): BufferGlyph {
  return {
    id,
    cluster,
    xAdvance: 0,
    yAdvance: 0,
    xOffset: 0,
    yOffset: 0,
    ligatureId: 0,
    ligatureComponent: 0,
    componentCount: 0,
    attachedTo: -1,
  };
}

/** The glyph sequence plus what lookups need to know to walk it. */
export class ShapingBuffer {
  glyphs: BufferGlyph[];
  readonly gdef: Gdef | undefined;
  #nextLigatureId = 1;

  constructor(glyphs: BufferGlyph[], gdef: Gdef | undefined) {
    this.glyphs = glyphs;
    this.gdef = gdef;
  }

  newLigatureId(): number {
    return this.#nextLigatureId++;
  }

  isMark(index: number): boolean {
    return this.gdef?.glyphClass((this.glyphs[index] as BufferGlyph).id) === GLYPH_CLASS_MARK;
  }

  /** Whether a lookup must pass over the glyph at `index` (OpenType spec, lookup flags). */
  skips(index: number, lookup: Lookup): boolean {
    const gdef = this.gdef;
    if (!gdef) return false;
    const flag = lookup.flag;
    const glyph = (this.glyphs[index] as BufferGlyph).id;
    const glyphClass = gdef.glyphClass(glyph);
    if (glyphClass === GLYPH_CLASS_BASE) return (flag & IGNORE_BASE_GLYPHS) !== 0;
    if (glyphClass === GLYPH_CLASS_LIGATURE) return (flag & IGNORE_LIGATURES) !== 0;
    if (glyphClass === GLYPH_CLASS_MARK) {
      if (flag & IGNORE_MARKS) return true;
      if (flag & USE_MARK_FILTERING_SET) return !gdef.inMarkSet(lookup.markFilteringSet, glyph);
      const attachType = flag & MARK_ATTACHMENT_TYPE_MASK;
      if (attachType) return gdef.markAttachClass(glyph) !== attachType >> 8;
    }
    return false;
  }

  /** Index of the next glyph after `index` that the lookup does not skip, or -1. */
  next(index: number, lookup: Lookup): number {
    for (let i = index + 1; i < this.glyphs.length; i++) {
      if (!this.skips(i, lookup)) return i;
    }
    return -1;
  }

  /** Index of the nearest glyph before `index` that the lookup does not skip, or -1. */
  previous(index: number, lookup: Lookup): number {
    for (let i = index - 1; i >= 0; i--) {
      if (!this.skips(i, lookup)) return i;
    }
    return -1;
  }
}
