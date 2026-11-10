/**
 * The drawing surface of a `Canvas` element: records shapes into the display list.
 */
import type { Color } from "../core/index.ts";
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

const KAPPA = 0.5522847498307936;

/**
 * Draws lines and shapes. Build a path with the shape and path methods, then paint it with
 * `fill`, `stroke` or `fillAndStroke`; painting starts a new path. Methods can be chained.
 */
export class CanvasContext {
  readonly #items: DisplayItem[];
  readonly #defaultColor: Color;
  #path: PathCommand[] = [];

  constructor(items: DisplayItem[], defaultColor: Color) {
    this.#items = items;
    this.#defaultColor = defaultColor;
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
    return this.moveTo(x, y)
      .lineTo(x + width, y)
      .lineTo(x + width, y + height)
      .lineTo(x, y + height)
      .closePath();
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
  if (r === 0) {
    return [
      ["M", x, y],
      ["L", x + width, y],
      ["L", x + width, y + height],
      ["L", x, y + height],
      ["Z"],
    ];
  }
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
