import { ByteWriter } from "./bytes.ts";
import type { Color } from "./color.ts";
import type { FontProgram } from "./embedded-font.ts";
import type { PositionedGlyph } from "./glyph-run.ts";
import { orientationMatrix, type PdfImage } from "./image.ts";
import { PdfName } from "./objects.ts";
import { formatNumber, writeObject } from "./serialize.ts";
import type { StandardFont } from "./standard-font.ts";

export type FillRule = "nonzero" | "evenodd";
export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

/** How glyphs are painted (ISO 32000-1, table 106). */
export type TextRenderingMode =
  | "fill"
  | "stroke"
  | "fillStroke"
  | "invisible"
  | "fillClip"
  | "strokeClip"
  | "fillStrokeClip"
  | "clip";

export interface Opacity {
  /** Opacity of fills, 0–1. */
  fill?: number;
  /** Opacity of strokes, 0–1. */
  stroke?: number;
}

/** Hands out resource names for things a content stream refers to by name. */
export interface ContentResources {
  /** Returns the resource name of a graphics state with these opacities. */
  opacity(fill: number | undefined, stroke: number | undefined): string;
  /** Registers a font with the page and returns how to refer to it and write text in it. */
  font(font: AnyFont): FontBinding;
  /** Registers an image with the page and returns its resource name. */
  image(image: PdfImage): string;
  /** Registers a spot colour's colour space with the page and returns its resource name. */
  spotColor(color: Extract<Color, { space: "spot" }>): string;
}

/** A font that every viewer has built in, or a font program to embed. */
export type AnyFont = StandardFont | FontProgram;

/** A font as seen from a content stream. */
export interface FontBinding {
  /** The resource name, such as `F1`. */
  readonly name: string;
  /**
   * Writes the operators that show `text` in this font. `size` and `rise` are the current font
   * size and text rise, which a font needs when it moves glyphs off the baseline.
   */
  show(out: ByteWriter, text: string, size: number, rise: number): void;
  /** Writes the operators that show glyphs which are already shaped and positioned. */
  showGlyphs(
    out: ByteWriter,
    glyphs: readonly PositionedGlyph[],
    text: string,
    size: number,
    rise: number,
  ): void;
}

interface TextState {
  font: FontBinding | undefined;
  size: number;
  rise: number;
}

const TEXT_RENDERING_MODES: Record<TextRenderingMode, number> = {
  fill: 0,
  stroke: 1,
  fillStroke: 2,
  invisible: 3,
  fillClip: 4,
  strokeClip: 5,
  fillStrokeClip: 6,
  clip: 7,
};

const LINE_CAPS: Record<LineCap, number> = { butt: 0, round: 1, square: 2 };
const LINE_JOINS: Record<LineJoin, number> = { miter: 0, round: 1, bevel: 2 };

/** Distance of a Bézier control point from the end point when approximating a quarter circle. */
const KAPPA = 0.5522847498307936;

const n = (value: number): string => formatNumber(value, 3);
/** Scale and rotation factors need more digits than coordinates do. */
const factor = (value: number): string => formatNumber(value, 6);

/**
 * Builds a page content stream, one PDF operator per method (ISO 32000-1, clause 8).
 *
 * Coordinates are in PDF's own space: points, origin at the bottom-left of the page, y growing
 * upward. Methods return `this` so calls can be chained.
 */
export class ContentStream {
  readonly #out: ByteWriter = new ByteWriter();
  readonly #resources: ContentResources | undefined;
  /** The text state at each save() level; the last entry is the current one. */
  readonly #text: TextState[] = [{ font: undefined, size: 0, rise: 0 }];
  #inText = false;

  constructor(resources?: ContentResources) {
    this.#resources = resources;
  }

  // ----- graphics state -----

  /** Saves the graphics state (`q`). Every save needs a matching {@link restore}. */
  save(): this {
    this.#noText("save()");
    this.#text.push({ ...this.#state });
    return this.#op("q");
  }

  /** Restores the most recently saved graphics state (`Q`). */
  restore(): this {
    this.#noText("restore()");
    if (this.#text.length === 1) throw new Error("restore() without a matching save()");
    this.#text.pop();
    return this.#op("Q");
  }

  /** Runs `draw` between a save and a restore. */
  group(draw: (content: this) => void): this {
    this.save();
    draw(this);
    return this.restore();
  }

  /** Multiplies the current transformation matrix by `[a b c d e f]` (`cm`). */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): this {
    return this.#op("cm", factor(a), factor(b), factor(c), factor(d), n(e), n(f));
  }

  translate(x: number, y: number): this {
    return this.transform(1, 0, 0, 1, x, y);
  }

  scale(x: number, y: number = x): this {
    return this.transform(x, 0, 0, y, 0, 0);
  }

  /** Rotates counter-clockwise about the origin, or about `(cx, cy)` when given. */
  rotate(degrees: number, cx = 0, cy = 0): this {
    const angle = (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return this.transform(cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos);
  }

  lineWidth(width: number): this {
    if (!(width >= 0)) throw new RangeError("Line width cannot be negative");
    return this.#op("w", n(width));
  }

  lineCap(cap: LineCap): this {
    return this.#op("J", String(LINE_CAPS[cap]));
  }

  lineJoin(join: LineJoin): this {
    return this.#op("j", String(LINE_JOINS[join]));
  }

  miterLimit(limit: number): this {
    if (!(limit >= 1)) throw new RangeError("Miter limit must be at least 1");
    return this.#op("M", n(limit));
  }

  /** Sets the dash pattern: lengths of alternating dashes and gaps. Empty means a solid line. */
  dash(pattern: readonly number[], phase = 0): this {
    if (pattern.some((length) => !(length >= 0))) {
      throw new RangeError("Dash lengths cannot be negative");
    }
    if (pattern.length > 0 && pattern.every((length) => length === 0)) {
      throw new RangeError("A dash pattern cannot be all zeros");
    }
    return this.#op("d", `[${pattern.map(n).join(" ")}]`, n(phase));
  }

  /** Sets fill and stroke opacity; a single number sets both. Needs a page to hold the resource. */
  opacity(value: number | Opacity): this {
    const { fill, stroke } = typeof value === "number" ? { fill: value, stroke: value } : value;
    for (const part of [fill, stroke]) {
      if (part !== undefined && !(part >= 0 && part <= 1)) {
        throw new RangeError(`Opacity must be between 0 and 1, got ${part}`);
      }
    }
    if (fill === undefined && stroke === undefined) return this;
    if (!this.#resources) {
      throw new Error("opacity() needs a content stream that belongs to a page");
    }
    return this.graphicsState(this.#resources.opacity(fill, stroke));
  }

  /** Applies a named graphics state from the page's `ExtGState` resources (`gs`). */
  graphicsState(resourceName: string): this {
    return this.#op("gs", this.#name(resourceName));
  }

  // ----- colour -----

  fillColor(color: Color): this {
    return this.#color(color, false);
  }

  strokeColor(color: Color): this {
    return this.#color(color, true);
  }

  // ----- path construction -----

  moveTo(x: number, y: number): this {
    return this.#op("m", n(x), n(y));
  }

  lineTo(x: number, y: number): this {
    return this.#op("l", n(x), n(y));
  }

  /** Cubic Bézier curve to `(x, y)` with control points `(x1, y1)` and `(x2, y2)`. */
  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    return this.#op("c", n(x1), n(y1), n(x2), n(y2), n(x), n(y));
  }

  /** Quadratic Bézier curve from `(fromX, fromY)`, the current point, to `(x, y)`. */
  quadraticCurveTo(
    fromX: number,
    fromY: number,
    cx: number,
    cy: number,
    x: number,
    y: number,
  ): this {
    return this.curveTo(
      fromX + (2 / 3) * (cx - fromX),
      fromY + (2 / 3) * (cy - fromY),
      x + (2 / 3) * (cx - x),
      y + (2 / 3) * (cy - y),
      x,
      y,
    );
  }

  closePath(): this {
    return this.#op("h");
  }

  rect(x: number, y: number, width: number, height: number): this {
    return this.#op("re", n(x), n(y), n(width), n(height));
  }

  /** A rectangle with rounded corners. The radius is capped at half the shorter side. */
  roundedRect(x: number, y: number, width: number, height: number, radius: number): this {
    const r = Math.min(Math.abs(radius), Math.abs(width) / 2, Math.abs(height) / 2);
    if (r === 0) return this.rect(x, y, width, height);
    const k = r * (1 - KAPPA);
    const right = x + width;
    const top = y + height;
    return this.moveTo(x + r, y)
      .lineTo(right - r, y)
      .curveTo(right - k, y, right, y + k, right, y + r)
      .lineTo(right, top - r)
      .curveTo(right, top - k, right - k, top, right - r, top)
      .lineTo(x + r, top)
      .curveTo(x + k, top, x, top - k, x, top - r)
      .lineTo(x, y + r)
      .curveTo(x, y + k, x + k, y, x + r, y)
      .closePath();
  }

  ellipse(cx: number, cy: number, rx: number, ry: number = rx): this {
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    return this.moveTo(cx + rx, cy)
      .curveTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry)
      .curveTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy)
      .curveTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry)
      .curveTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy)
      .closePath();
  }

  circle(cx: number, cy: number, radius: number): this {
    return this.ellipse(cx, cy, radius, radius);
  }

  // ----- path painting -----

  fill(rule: FillRule = "nonzero"): this {
    return this.#op(rule === "evenodd" ? "f*" : "f");
  }

  stroke(): this {
    return this.#op("S");
  }

  fillAndStroke(rule: FillRule = "nonzero"): this {
    return this.#op(rule === "evenodd" ? "B*" : "B");
  }

  /** Discards the current path without painting it (`n`). */
  endPath(): this {
    return this.#op("n");
  }

  /**
   * Intersects the clipping region with the current path, then discards the path. The clip
   * lasts until the enclosing {@link restore}.
   */
  clip(rule: FillRule = "nonzero"): this {
    this.#op(rule === "evenodd" ? "W*" : "W");
    return this.#op("n");
  }

  // ----- text -----

  /** Selects the font and size for the text that follows (`Tf`). Needs a page. */
  font(font: AnyFont, size: number): this {
    if (!(size > 0)) throw new RangeError("Font size must be positive");
    if (!this.#resources) throw new Error("font() needs a content stream that belongs to a page");
    const binding = this.#resources.font(font);
    this.#state.font = binding;
    this.#state.size = size;
    return this.#op("Tf", this.#name(binding.name), n(size));
  }

  /** Begins a text object (`BT`). Text can only be shown between this and {@link endText}. */
  beginText(): this {
    this.#noText("beginText()");
    this.#inText = true;
    return this.#op("BT");
  }

  endText(): this {
    this.#needText("endText()");
    this.#inText = false;
    return this.#op("ET");
  }

  /** Moves to the start of a new line, offset from the start of the current one (`Td`). */
  moveText(dx: number, dy: number): this {
    this.#needText("moveText()");
    return this.#op("Td", n(dx), n(dy));
  }

  /** Sets the text matrix, placing and transforming the text that follows (`Tm`). */
  textMatrix(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.#needText("textMatrix()");
    return this.#op("Tm", factor(a), factor(b), factor(c), factor(d), n(e), n(f));
  }

  /** Shows text at the current position in the current font (`Tj`). */
  showText(text: string): this {
    this.#needText("showText()");
    const state = this.#state;
    if (!state.font) throw new Error("Select a font with font() before showing text");
    state.font.show(this.#out, text, state.size, state.rise);
    return this;
  }

  /**
   * Shows glyphs that a shaper or the text layout has already chosen and positioned, in the
   * current font. `text` is what the glyphs stand for (used for copy and search); each glyph's
   * `cluster` is an offset into it. Unlike {@link showText}, a missing glyph (ID 0) is drawn
   * as the font's "missing" box instead of raising an error.
   */
  showGlyphs(glyphs: readonly PositionedGlyph[], text: string): this {
    this.#needText("showGlyphs()");
    const state = this.#state;
    if (!state.font) throw new Error("Select a font with font() before showing text");
    state.font.showGlyphs(this.#out, glyphs, text, state.size, state.rise);
    return this;
  }

  /** Draws one line of text with its baseline starting at `(x, y)`. */
  text(text: string, x: number, y: number): this {
    return this.beginText().moveText(x, y).showText(text).endText();
  }

  /** Extra space after every glyph, in points (`Tc`). */
  characterSpacing(spacing: number): this {
    return this.#op("Tc", n(spacing));
  }

  /** Extra space after every space character, in points (`Tw`). */
  wordSpacing(spacing: number): this {
    return this.#op("Tw", n(spacing));
  }

  /** Raises (or, when negative, lowers) the baseline, for superscripts and subscripts (`Ts`). */
  textRise(rise: number): this {
    this.#state.rise = rise;
    return this.#op("Ts", n(rise));
  }

  textRenderingMode(mode: TextRenderingMode): this {
    return this.#op("Tr", String(TEXT_RENDERING_MODES[mode]));
  }

  // ----- images -----

  /**
   * Draws an image in the rectangle with its lower-left corner at `(x, y)`, stretched to
   * `width` × `height`. A photo's EXIF orientation is applied, so it appears upright; use
   * `orientedSize(image)` to get its proportions. Needs a page.
   */
  image(image: PdfImage, x: number, y: number, width: number, height: number): this {
    if (!this.#resources) throw new Error("image() needs a content stream that belongs to a page");
    this.#noText("image()");
    const resourceName = this.#resources.image(image);
    this.save().transform(width, 0, 0, height, x, y);
    const orientation = orientationMatrix(image.orientation);
    if (image.orientation !== undefined && image.orientation !== 1) this.transform(...orientation);
    this.#op("Do", this.#name(resourceName));
    return this.restore();
  }

  // ----- escape hatch and output -----

  /** Appends operators verbatim. */
  raw(operators: string): this {
    this.#out.ascii(operators);
    if (!operators.endsWith("\n")) this.#out.byte(0x0a);
    return this;
  }

  /** The finished stream. Throws if a save() was never restored. */
  toBytes(): Uint8Array {
    if (this.#inText) throw new Error("beginText() without a matching endText()");
    if (this.#text.length !== 1) {
      throw new Error(`${this.#text.length - 1} save() call(s) without a matching restore()`);
    }
    return this.#out.toBytes();
  }

  #color(color: Color, stroking: boolean): this {
    switch (color.space) {
      case "gray":
        return this.#op(stroking ? "G" : "g", n(color.gray));
      case "rgb":
        return this.#op(stroking ? "RG" : "rg", n(color.r), n(color.g), n(color.b));
      case "cmyk":
        return this.#op(stroking ? "K" : "k", n(color.c), n(color.m), n(color.y), n(color.k));
      case "spot": {
        if (!this.#resources)
          throw new Error("Spot colours need a content stream that belongs to a page");
        const space = this.#name(this.#resources.spotColor(color));
        this.#op(stroking ? "CS" : "cs", space);
        return this.#op(stroking ? "SCN" : "scn", n(color.tint));
      }
    }
  }

  get #state(): TextState {
    return this.#text.at(-1) as TextState;
  }

  #noText(what: string): void {
    if (this.#inText) throw new Error(`${what} is not allowed inside a text object`);
  }

  #needText(what: string): void {
    if (!this.#inText) throw new Error(`${what} is only allowed between beginText() and endText()`);
  }

  #name(value: string): string {
    const out = new ByteWriter();
    writeObject(out, new PdfName(value));
    return String.fromCharCode(...out.toBytes());
  }

  #op(operator: string, ...operands: string[]): this {
    for (const operand of operands) {
      this.#out.ascii(operand);
      this.#out.byte(0x20);
    }
    this.#out.ascii(operator);
    this.#out.byte(0x0a);
    return this;
  }
}
