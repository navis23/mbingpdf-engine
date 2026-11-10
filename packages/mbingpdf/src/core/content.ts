import { ByteWriter } from "./bytes.ts";
import type { Color } from "./color.ts";
import { PdfName } from "./objects.ts";
import { formatNumber, writeObject } from "./serialize.ts";

export type FillRule = "nonzero" | "evenodd";
export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

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
}

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
  #depth = 0;

  constructor(resources?: ContentResources) {
    this.#resources = resources;
  }

  // ----- graphics state -----

  /** Saves the graphics state (`q`). Every save needs a matching {@link restore}. */
  save(): this {
    this.#depth++;
    return this.#op("q");
  }

  /** Restores the most recently saved graphics state (`Q`). */
  restore(): this {
    if (this.#depth === 0) throw new Error("restore() without a matching save()");
    this.#depth--;
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

  // ----- escape hatch and output -----

  /** Appends operators verbatim. */
  raw(operators: string): this {
    this.#out.ascii(operators);
    if (!operators.endsWith("\n")) this.#out.byte(0x0a);
    return this;
  }

  /** The finished stream. Throws if a save() was never restored. */
  toBytes(): Uint8Array {
    if (this.#depth !== 0) {
      throw new Error(`${this.#depth} save() call(s) without a matching restore()`);
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
    }
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
