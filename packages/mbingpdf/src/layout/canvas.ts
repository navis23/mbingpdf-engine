/**
 * The drawing surface of a `Canvas` element: records shapes into the display list.
 */
import type { Color } from "../core/index.ts";
import type { TextFont } from "../text/index.ts";
import type { DisplayItem, PathCommand, StrokeStyle } from "./display.ts";
import { toColor } from "./style.ts";
import type { ColorInput } from "./types.ts";

export interface CanvasStroke {
  color?: ColorInput;
  /** Line thickness in points. Default 1. */
  width?: number;
  dash?: readonly number[];
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
}

export interface CanvasText {
  /** Font size in points. Default: the size of the text around the canvas. */
  size?: number;
  /** Default: the text colour. */
  color?: ColorInput;
  /** Default: the font of the text around the canvas. */
  font?: TextFont | readonly TextFont[];
  /** Which part of the text sits at `x`: its left end (default), its centre or its right end. */
  align?: "left" | "center" | "right";
  /**
   * Which part of the text sits at `y`: the baseline the letters stand on (default), the top
   * of tall letters, their middle, or the bottom of letters that hang below the line.
   */
  baseline?: "alphabetic" | "top" | "middle" | "bottom";
  /** Clockwise rotation in degrees about `(x, y)`: -90 reads upward, for an axis title. */
  rotate?: number;
}

const KAPPA = 0.5522847498307936;

/** Vertical measures some fonts carry and others do not. */
type FontMetrics = TextFont & { ascender?: number; descender?: number; capHeight?: number };

/**
 * Draws lines and shapes. Build a path with the shape and path methods, then paint it with
 * `fill`, `stroke` or `fillAndStroke`; painting starts a new path. Methods can be chained.
 */
export class CanvasContext {
  readonly #items: DisplayItem[];
  readonly #defaultColor: Color;
  readonly #fonts: readonly TextFont[];
  readonly #size: number;
  #path: PathCommand[] = [];

  constructor(
    items: DisplayItem[],
    defaultColor: Color,
    text: { fonts: readonly TextFont[]; size: number },
  ) {
    this.#items = items;
    this.#defaultColor = defaultColor;
    this.#fonts = text.fonts;
    this.#size = text.size;
  }

  /** The font to set a piece of text in: the first of the list that has all its characters. */
  #fontFor(text: string, options: CanvasText): TextFont {
    const fonts =
      options.font === undefined
        ? this.#fonts
        : Array.isArray(options.font)
          ? (options.font as readonly TextFont[])
          : [options.font as TextFont];
    return fonts.find((font) => font.hasGlyphsFor(text)) ?? (fonts[0] as TextFont);
  }

  /** The width of a piece of text in points, as {@link text} would draw it. */
  measureText(text: string, options: CanvasText = {}): number {
    const font = this.#fontFor(text, options);
    let advance = 0;
    for (const glyph of font.shape(text)) advance += glyph.xAdvance;
    return (advance * (options.size ?? this.#size)) / font.unitsPerEm;
  }

  /**
   * Draws one line of text at `(x, y)`. It is not wrapped; measure it with
   * {@link measureText} if it has to fit somewhere.
   */
  text(text: string, x: number, y: number, options: CanvasText = {}): this {
    if (text === "") return this;
    const font = this.#fontFor(text, options) as FontMetrics;
    const size = options.size ?? this.#size;
    const scale = size / font.unitsPerEm;
    const glyphs = font.shape(text);
    let advance = 0;
    for (const glyph of glyphs) advance += glyph.xAdvance;
    const width = advance * scale;
    const left =
      options.align === "center" ? x - width / 2 : options.align === "right" ? x - width : x;
    const ascender = font.ascender ?? font.unitsPerEm * 0.8;
    const descender = font.descender ?? -font.unitsPerEm * 0.2;
    const capHeight = font.capHeight && font.capHeight > 0 ? font.capHeight : ascender * 0.75;
    const baseline =
      options.baseline === "top"
        ? y + capHeight * scale
        : options.baseline === "middle"
          ? y + (capHeight * scale) / 2
          : options.baseline === "bottom"
            ? y + descender * scale
            : y;
    const item: DisplayItem = {
      type: "text",
      x: left,
      y: baseline,
      font,
      size,
      color: options.color === undefined ? this.#defaultColor : toColor(options.color),
      glyphs,
      text,
    };
    this.#items.push(
      options.rotate
        ? { type: "group", rotate: { degrees: options.rotate, cx: x, cy: y }, items: [item] }
        : item,
    );
    return this;
  }

  moveTo(x: number, y: number): this {
    this.#path.push(["M", x, y]);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.#path.push(["L", x, y]);
    return this;
  }

  /** Cubic Bézier curve to `(x, y)` with two control points. */
  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.#path.push(["C", x1, y1, x2, y2, x, y]);
    return this;
  }

  closePath(): this {
    this.#path.push(["Z"]);
    return this;
  }

  rect(x: number, y: number, width: number, height: number): this {
    this.#path.push(["R", x, y, width, height]);
    return this;
  }

  roundedRect(x: number, y: number, width: number, height: number, radius: number): this {
    this.#path.push(...roundedRectPath(x, y, width, height, radius));
    return this;
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

  /** A straight line from one point to another, as a path of its own. */
  line(x1: number, y1: number, x2: number, y2: number): this {
    return this.moveTo(x1, y1).lineTo(x2, y2);
  }

  /** Fills the current path. Default colour: the text colour. */
  fill(color?: ColorInput): this {
    return this.#paint(color === undefined ? this.#defaultColor : toColor(color), undefined);
  }

  /** Strokes the current path. */
  stroke(style: CanvasStroke = {}): this {
    return this.#paint(undefined, this.#stroke(style));
  }

  fillAndStroke(color: ColorInput, style: CanvasStroke = {}): this {
    return this.#paint(toColor(color), this.#stroke(style));
  }

  #stroke(style: CanvasStroke): StrokeStyle {
    return {
      color: style.color === undefined ? this.#defaultColor : toColor(style.color),
      width: style.width ?? 1,
      ...(style.dash ? { dash: style.dash } : {}),
      ...(style.cap ? { cap: style.cap } : {}),
      ...(style.join ? { join: style.join } : {}),
    };
  }

  #paint(fill: Color | undefined, stroke: StrokeStyle | undefined): this {
    if (this.#path.length > 0) {
      this.#items.push({
        type: "path",
        commands: this.#path,
        ...(fill ? { fill } : {}),
        ...(stroke ? { stroke } : {}),
      });
    }
    this.#path = [];
    return this;
  }
}

/** The path of a rectangle with rounded corners. */
export function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): PathCommand[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r === 0) return [["R", x, y, width, height]];
  const k = r * (1 - KAPPA);
  const right = x + width;
  const bottom = y + height;
  return [
    ["M", x + r, y],
    ["L", right - r, y],
    ["C", right - k, y, right, y + k, right, y + r],
    ["L", right, bottom - r],
    ["C", right, bottom - k, right - k, bottom, right - r, bottom],
    ["L", x + r, bottom],
    ["C", x + k, bottom, x, bottom - k, x, bottom - r],
    ["L", x, y + r],
    ["C", x, y + k, x + k, y, x + r, y],
    ["Z"],
  ];
}
