/** Turning the loose forms that properties accept into the exact values layout works with. */
import { type Color, gray, hex, PageSizes, StandardFonts } from "../core/index.ts";
import type { InlineStyle, TextAlign, TextFont } from "../text/index.ts";
import type {
  Border,
  BorderSide,
  ColorInput,
  Edges,
  Length,
  PageSizeInput,
  TextProps,
} from "./types.ts";

export interface Sides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_SIDES: Sides = { top: 0, right: 0, bottom: 0, left: 0 };

export function toColor(input: ColorInput): Color {
  return typeof input === "string" ? hex(input) : input;
}

export function toSides(edges: Edges | undefined): Sides {
  if (edges === undefined) return NO_SIDES;
  if (typeof edges === "number") return { top: edges, right: edges, bottom: edges, left: edges };
  if (Array.isArray(edges)) {
    const values = edges as readonly number[];
    if (values.length === 2) {
      const [vertical = 0, horizontal = 0] = values;
      return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
    }
    const [top = 0, right = 0, bottom = 0, left = 0] = values;
    return { top, right, bottom, left };
  }
  const named = edges as { top?: number; right?: number; bottom?: number; left?: number };
  return {
    top: named.top ?? 0,
    right: named.right ?? 0,
    bottom: named.bottom ?? 0,
    left: named.left ?? 0,
  };
}

export interface ResolvedBorder {
  top?: { width: number; color: Color };
  right?: { width: number; color: Color };
  bottom?: { width: number; color: Color };
  left?: { width: number; color: Color };
}

export function toBorder(border: Border | undefined, fallback: Color): ResolvedBorder {
  if (!border) return {};
  const side = (value: BorderSide | undefined): { width: number; color: Color } | undefined =>
    value && value.width > 0
      ? { width: value.width, color: value.color === undefined ? fallback : toColor(value.color) }
      : undefined;
  if ("width" in border) {
    const all = side(border);
    return all ? { top: all, right: all, bottom: all, left: all } : {};
  }
  const result: ResolvedBorder = {};
  for (const name of ["top", "right", "bottom", "left"] as const) {
    const value = side(border[name]);
    if (value) result[name] = value;
  }
  return result;
}

export function borderWidths(border: ResolvedBorder): Sides {
  return {
    top: border.top?.width ?? 0,
    right: border.right?.width ?? 0,
    bottom: border.bottom?.width ?? 0,
    left: border.left?.width ?? 0,
  };
}

/** Resolves a length against the space available; undefined stays undefined. */
export function toPoints(length: Length | undefined, available: number): number | undefined {
  if (length === undefined) return undefined;
  if (typeof length === "number") return length;
  const percent = Number.parseFloat(length);
  if (!length.endsWith("%") || Number.isNaN(percent)) {
    throw new RangeError(
      `Not a length: "${length}". Use a number of points or a percentage such as "50%".`,
    );
  }
  return (available * percent) / 100;
}

export function toPageSize(
  size: PageSizeInput | undefined,
  orientation: "portrait" | "landscape" | undefined,
): [number, number] {
  let width: number;
  let height: number;
  if (size === undefined || typeof size === "string") {
    const named = PageSizes[size ?? "A4"];
    if (!named) throw new RangeError(`Unknown page size "${size}"`);
    [width, height] = named;
  } else {
    [width, height] = size;
  }
  if (!(width > 0 && height > 0)) throw new RangeError("Page width and height must be positive");
  const landscape = orientation === "landscape";
  // A named size is portrait; a custom size is taken as given unless an orientation is asked for.
  if (orientation !== undefined && landscape !== width > height) return [height, width];
  return [width, height];
}

/** The text properties in effect at some point in the tree, with nothing left undefined. */
export interface TextContext {
  font: TextFont | readonly TextFont[];
  size: number;
  color: Color;
  lineHeight: number | undefined;
  letterSpacing: number;
  wordSpacing: number;
  textAlign: TextAlign;
  features: Readonly<Record<string, boolean | number>> | undefined;
  transform: NonNullable<TextProps["transform"]>;
  hyphenate: TextProps["hyphenate"];
  underline: boolean;
  strikethrough: boolean;
  orphans: number;
  widows: number;
}

export const DEFAULT_TEXT: TextContext = {
  font: StandardFonts.Helvetica,
  size: 10,
  color: gray(0),
  lineHeight: undefined,
  letterSpacing: 0,
  wordSpacing: 0,
  textAlign: "left",
  features: undefined,
  transform: "none",
  hyphenate: undefined,
  underline: false,
  strikethrough: false,
  orphans: 2,
  widows: 2,
};

/** The text context for an element's content: its own text properties over its parent's. */
export function inherit(parent: TextContext, props: TextProps): TextContext {
  return {
    font: props.font ?? parent.font,
    size: props.size ?? parent.size,
    color: props.color === undefined ? parent.color : toColor(props.color),
    lineHeight: props.lineHeight ?? parent.lineHeight,
    letterSpacing: props.letterSpacing ?? parent.letterSpacing,
    wordSpacing: props.wordSpacing ?? parent.wordSpacing,
    textAlign: props.textAlign ?? parent.textAlign,
    features: props.features ?? parent.features,
    transform: props.transform ?? parent.transform,
    hyphenate: props.hyphenate ?? parent.hyphenate,
    underline: props.underline ?? parent.underline,
    strikethrough: props.strikethrough ?? parent.strikethrough,
    orphans: props.orphans ?? parent.orphans,
    widows: props.widows ?? parent.widows,
  };
}

/** The style of a span of text, as the paragraph layout wants it. */
export function inlineStyle(context: TextContext, link?: string, linkTo?: string): InlineStyle {
  return {
    font: context.font,
    size: context.size,
    color: context.color,
    letterSpacing: context.letterSpacing,
    wordSpacing: context.wordSpacing,
    transform: context.transform,
    underline: context.underline,
    strikethrough: context.strikethrough,
    ...(context.features ? { features: context.features } : {}),
    ...(context.lineHeight !== undefined ? { lineHeight: context.lineHeight } : {}),
    ...(link !== undefined ? { link } : {}),
    ...(linkTo !== undefined ? { linkTo } : {}),
  };
}
