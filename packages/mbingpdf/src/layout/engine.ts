/**
 * The layout engine: turns a tree of elements into positioned boxes, one page at a time.
 *
 * Every element is laid out by a function that is given a width and the height left on the
 * page, and returns the part that fitted plus what it needs to carry on. That makes page
 * breaks a property of every element rather than something bolted on afterwards.
 */
import { type Color, orientedSize, type PdfImage } from "../core/index.ts";
import { decodeImage } from "../image/index.ts";
import { qrCode } from "../qr/index.ts";
import {
  type InlineSpan,
  layoutSpans,
  type ParagraphLayout,
  type TextLine,
} from "../text/index.ts";
import {
  borderWidths,
  inherit,
  inlineStyle,
  NO_SIDES,
  type ResolvedBorder,
  type Sides,
  type TextContext,
  toBorder,
  toColor,
  toPoints,
  toSides,
} from "./style.ts";
import { layoutTable, measureTable } from "./table.ts";
import type {
  AbsoluteProps,
  Align,
  BoxProps,
  CanvasProps,
  Child,
  GridProps,
  ImageProps,
  LayoutNode,
  ListProps,
  QrCodeProps,
  RowProps,
  SpacerProps,
  StackProps,
  TextElementProps,
} from "./types.ts";

/** A laid-out piece of an element. Positions are relative to the parent box. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  children: Box[];
  background?: Color;
  border?: ResolvedBorder;
  radius?: number;
  opacity?: number;
  /** Clockwise rotation in degrees about the centre. */
  rotate?: number;
  /** Positioned against the page instead of the parent. */
  page?: boolean;
  /** Lines of text, with where the first of them starts inside the box. */
  text?: { lines: readonly TextLine[]; x: number; y: number };
  image?: {
    image: PdfImage;
    x: number;
    y: number;
    width: number;
    height: number;
    clip: boolean;
  };
  canvas?: {
    draw: CanvasProps["draw"];
    color: Color;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** The space an element is laid out in. */
export interface Area {
  width: number;
  /** Height left on the current page. */
  height: number;
  /**
   * True when this is as much room as the element will ever get: it must place something,
   * because waiting for the next page would not help.
   */
  fresh: boolean;
  /** Shrink to the content's width instead of filling the area. */
  fit?: boolean;
}

export interface LayoutResult {
  /** The part that fitted; undefined when nothing did. */
  box?: Box;
  /** What is needed to continue on the next page; undefined when the element is finished. */
  state?: unknown;
}

/** Collected while laying out, for the caller to report. */
export interface LayoutSink {
  missingCharacters: Set<string>;
  /** Size of the page being laid out, for elements positioned against it. */
  page: { width: number; height: number };
}

/** Marks "not started; try again on the next page". */
export const RETRY: unique symbol = Symbol("retry");

/** Raised when content can never be placed, however many pages are added. */
export class LayoutError extends Error {
  override name = "LayoutError";
}

/** Flattens a list of children: arrays are spread, empty values dropped, text wrapped. */
export function normalize(children: readonly Child[]): LayoutNode[] {
  const out: LayoutNode[] = [];
  const visit = (child: Child): void => {
    if (child === null || child === undefined || child === false) return;
    if (typeof child === "string" || typeof child === "number") {
      out.push({ type: "Text", props: {}, children: [child] });
    } else if (Array.isArray(child)) {
      for (const item of child as readonly Child[]) visit(item);
    } else {
      out.push(child as LayoutNode);
    }
  };
  for (const child of children) visit(child);
  return out;
}

const boxProps = (node: LayoutNode): BoxProps => node.props as BoxProps;

function marginsOf(node: LayoutNode): Sides {
  if (node.type === "Spacer" || node.type === "PageBreak") return NO_SIDES;
  return toSides(boxProps(node).margin);
}

interface Decoration {
  padding: Sides;
  border: ResolvedBorder;
  /** Padding plus border on each side. */
  inset: Sides;
}

function decorationOf(node: LayoutNode, context: TextContext): Decoration {
  const props = boxProps(node);
  const padding = toSides(props.padding);
  const border = toBorder(props.border, context.color);
  const widths = borderWidths(border);
  return {
    padding,
    border,
    inset: {
      top: padding.top + widths.top,
      right: padding.right + widths.right,
      bottom: padding.bottom + widths.bottom,
      left: padding.left + widths.left,
    },
  };
}

/** Copies the visual properties of an element onto its box. */
function decorate(
  box: Box,
  node: LayoutNode,
  decoration: Decoration,
  open: { top: boolean; bottom: boolean },
): void {
  const props = boxProps(node);
  if (props.background !== undefined) box.background = toColor(props.background);
  if (props.radius) box.radius = props.radius;
  if (props.opacity !== undefined && props.opacity < 1) box.opacity = Math.max(0, props.opacity);
  const border = { ...decoration.border };
  // A box split across pages is cut open where it was split.
  if (open.top) delete border.top;
  if (open.bottom) delete border.bottom;
  if (border.top || border.right || border.bottom || border.left) box.border = border;
}

const imageCache: WeakMap<object, PdfImage> = new WeakMap();

function imageOf(source: ImageProps["src"]): PdfImage {
  if (!(source instanceof Uint8Array)) return source;
  let image = imageCache.get(source);
  if (!image) {
    image = decodeImage(source);
    imageCache.set(source, image);
  }
  return image;
}

/** CSS pixels to points: images without a stated size are shown at 96 pixels per inch. */
const PX = 0.75;

function collectSpans(
  node: LayoutNode,
  context: TextContext,
  link: string | undefined,
  out: InlineSpan[],
): void {
  const visit = (child: Child): void => {
    if (child === null || child === undefined || child === false) return;
    if (typeof child === "string" || typeof child === "number") {
      out.push({ text: String(child), style: inlineStyle(context, link) });
    } else if (Array.isArray(child)) {
      for (const item of child as readonly Child[]) visit(item);
    } else {
      const element = child as LayoutNode;
      if (element.type !== "Span") {
        throw new LayoutError(
          `Text can only contain strings and Span or Link elements, not ${element.type}`,
        );
      }
      const props = (element as LayoutNode<"Span">).props;
      collectSpans(element, inherit(context, props), props.href ?? link, out);
    }
  };
  for (const child of node.children) visit(child);
}

function textContext(node: LayoutNode<"Text">, context: TextContext): TextContext {
  const own = inherit(context, node.props);
  return node.props.align ? { ...own, textAlign: node.props.align } : own;
}

function paragraphOf(
  node: LayoutNode<"Text">,
  context: TextContext,
  width: number | undefined,
): ParagraphLayout | undefined {
  const own = textContext(node, context);
  const spans: InlineSpan[] = [];
  collectSpans(node, own, undefined, spans);
  if (spans.length === 0) return undefined;
  return layoutSpans(spans, {
    align: own.textAlign,
    ...(width !== undefined ? { width: Math.max(width, 0.01) } : {}),
    ...(own.hyphenate ? { hyphenate: own.hyphenate } : {}),
  });
}

/**
 * Lays out a text on one line at the size that makes it fill `width`, within the limits its
 * `fit` property gives. Returns the paragraph and where the line starts for its alignment.
 */
function fitParagraph(
  node: LayoutNode<"Text">,
  context: TextContext,
  width: number,
): { paragraph: ParagraphLayout; offset: number } | undefined {
  const fit = node.props.fit;
  const own = textContext(node, context);
  const spans: InlineSpan[] = [];
  collectSpans(node, own, undefined, spans);
  if (spans.length === 0 || !fit) return undefined;
  const base = own.size;
  const limits = typeof fit === "object" ? fit : {};
  const max = limits.max ?? base;
  const min = Math.min(limits.min ?? max / 10, max);

  /** The spans with every font size multiplied by `scale`, on one unwrapped line. */
  const at = (scale: number, spacing: boolean): ParagraphLayout =>
    layoutSpans(
      spans.map((span) => ({
        text: span.text.replace(/\s*\n\s*/g, " "),
        style: {
          ...span.style,
          size: span.style.size * scale,
          ...(spacing ? {} : { letterSpacing: 0, wordSpacing: 0 }),
        },
      })),
    );
  // Glyph widths grow with the size; letter and word spacing are fixed amounts.
  const natural = at(max / base, true);
  let paragraph = natural;
  if (natural.width > width) {
    const scalable = at(max / base, false).width;
    const fixed = natural.width - scalable;
    const scale = scalable > 0 ? ((width - fixed) / scalable) * (max / base) : max / base;
    paragraph = at(Math.max(min / base, Math.min(max / base, scale)), true);
  }
  const slack = width - paragraph.width;
  const offset = own.textAlign === "center" ? slack / 2 : own.textAlign === "right" ? slack : 0;
  return { paragraph, offset };
}

/** The narrowest and the natural width of an element's border box. */
export function measure(node: LayoutNode, context: TextContext): { min: number; max: number } {
  const props = boxProps(node);
  if (typeof props.width === "number") return { min: props.width, max: props.width };
  let min = 0;
  let max = 0;
  switch (node.type) {
    case "Text": {
      const paragraph = paragraphOf(node as LayoutNode<"Text">, context, undefined);
      if (paragraph) {
        min = paragraph.minContentWidth;
        max = paragraph.width;
      }
      break;
    }
    case "Stack":
    case "Absolute": {
      const own = inherit(context, props);
      for (const child of normalize(node.children)) {
        if (child.type === "Absolute") continue;
        const margin = marginsOf(child);
        const size = measure(child, own);
        min = Math.max(min, size.min + margin.left + margin.right);
        max = Math.max(max, size.max + margin.left + margin.right);
      }
      break;
    }
    case "Row": {
      const own = inherit(context, props);
      const children = normalize(node.children).filter((child) => child.type !== "Absolute");
      for (const child of children) {
        const margin = marginsOf(child);
        const size = measure(child, own);
        min += size.min + margin.left + margin.right;
        max += size.max + margin.left + margin.right;
      }
      const gaps = ((node as LayoutNode<"Row">).props.gap ?? 0) * Math.max(0, children.length - 1);
      min += gaps;
      max += gaps;
      break;
    }
    case "Image": {
      const image = imageOf((node as LayoutNode<"Image">).props.src);
      const natural = orientedSize(image);
      const height = typeof props.height === "number" ? props.height : undefined;
      max = height !== undefined ? (height * natural.width) / natural.height : natural.width * PX;
      break;
    }
    case "Table": {
      const size = measureTable(node as LayoutNode<"Table">, context);
      return size;
    }
    case "List":
      return measure(expandList(node as LayoutNode<"List">, context), context);
    case "QrCode":
      max = min = (node as LayoutNode<"QrCode">).props.size ?? 72;
      break;
    case "Grid": {
      const grid = (node as LayoutNode<"Grid">).props;
      const gap = Array.isArray(grid.gap)
        ? (grid.gap[1] as number)
        : ((grid.gap as number | undefined) ?? 0);
      if (grid.cell.width !== undefined) {
        max = min = grid.columns * grid.cell.width + gap * (grid.columns - 1);
      }
      break;
    }
    default:
      break;
  }
  if (node.type !== "Spacer" && node.type !== "PageBreak") {
    const decoration = decorationOf(node, context);
    min += decoration.inset.left + decoration.inset.right;
    max += decoration.inset.left + decoration.inset.right;
  }
  const floor = typeof props.minWidth === "number" ? props.minWidth : 0;
  const ceiling = typeof props.maxWidth === "number" ? props.maxWidth : Number.POSITIVE_INFINITY;
  return {
    min: Math.min(Math.max(min, floor), ceiling),
    max: Math.min(Math.max(max, floor), ceiling),
  };
}

/** The width of an element's border box in an area. */
function widthIn(node: LayoutNode, context: TextContext, area: Area): number {
  const props = boxProps(node);
  let width = toPoints(props.width, area.width);
  if (width === undefined)
    width = area.fit ? Math.min(measure(node, context).max, area.width) : area.width;
  const floor = toPoints(props.minWidth, area.width);
  const ceiling = toPoints(props.maxWidth, area.width);
  if (ceiling !== undefined) width = Math.min(width, ceiling);
  if (floor !== undefined) width = Math.max(width, floor);
  return Math.max(0, width);
}

const keepsTogether = (node: LayoutNode): boolean => {
  const props = boxProps(node);
  return props.keepTogether === true || props.break === "avoid";
};

interface StackState {
  index: number;
  child: unknown;
  /** The forced break before child `index` has already been taken. */
  broke: boolean;
}

function layoutStack(
  node: LayoutNode,
  context: TextContext,
  area: Area,
  state: StackState | undefined,
  sink: LayoutSink,
): LayoutResult {
  const props = node.props as StackProps;
  const own = inherit(context, props);
  const decoration = decorationOf(node, context);
  const first = state === undefined;
  const top = first ? decoration.inset.top : 0;
  const width = widthIn(node, context, area);
  const innerWidth = Math.max(0, width - decoration.inset.left - decoration.inset.right);
  const gap = props.gap ?? 0;
  const align: Align = props.align ?? "stretch";
  const children = normalize(node.children);

  // A fixed height that cannot fit here waits for the next page; on a fresh page it is cut.
  const fixedHeight = first ? toPoints(props.height, area.height) : undefined;
  if (fixedHeight !== undefined && fixedHeight > area.height + 1e-6 && !area.fresh) {
    return { state: RETRY };
  }
  const limit = fixedHeight !== undefined ? Math.min(fixedHeight, area.height) : area.height;
  // Room for the bottom padding and border is held back, since the content may end here.
  const available = limit - decoration.inset.bottom;

  const box: Box = { x: 0, y: 0, width, height: 0, children: [] };
  const placed: { index: number; box: Box; y: number; whole: boolean }[] = [];
  const absolutes: LayoutNode<"Absolute">[] = [];
  let y = top;
  let index = state?.index ?? 0;
  let childState = state?.child;
  let broke = state?.broke ?? false;
  let next: StackState | undefined;

  while (index < children.length) {
    const child = children[index] as LayoutNode;
    if (child.type === "Absolute") {
      absolutes.push(child as LayoutNode<"Absolute">);
      index++;
      continue;
    }
    const started = placed.length > 0 || !area.fresh;
    if (child.type === "PageBreak") {
      index++;
      if (started) {
        next = { index, child: undefined, broke: false };
        break;
      }
      continue;
    }
    if (boxProps(child).break === "before" && started && !broke && childState === undefined) {
      next = { index, child: undefined, broke: true };
      break;
    }
    broke = false;

    const margin = marginsOf(child);
    const spacing = placed.length > 0 ? gap : 0;
    const remaining = available - y - spacing - margin.top - margin.bottom;
    const fresh = area.fresh && placed.length === 0;
    const childAlign = boxProps(child).alignSelf ?? align;
    const resuming = childState !== undefined && childState !== RETRY;
    let result = layout(
      child,
      own,
      {
        width: Math.max(0, innerWidth - margin.left - margin.right),
        height: remaining,
        fresh,
        fit: childAlign !== "stretch",
      },
      childState,
      sink,
    );
    // An element that must stay whole goes to the next page instead of being split.
    if (result.state !== undefined && result.box && keepsTogether(child) && !fresh && !resuming) {
      result = { state: RETRY };
    }
    if (!result.box) {
      if (fresh) {
        throw new LayoutError(
          `A ${child.type} element does not fit on an empty page and cannot be split`,
        );
      }
      next = { index, child: result.state ?? RETRY, broke: true };
      // A heading must not be left behind at the bottom of the page.
      while (placed.length > 1) {
        const last = placed.at(-1) as (typeof placed)[number];
        if (!last.whole || !boxProps(children[last.index] as LayoutNode).keepWithNext) break;
        placed.pop();
        box.children.splice(box.children.indexOf(last.box), 1);
        y = last.y;
        next = { index: last.index, child: undefined, broke: true };
      }
      break;
    }

    const childBox = result.box;
    const slack = innerWidth - margin.left - margin.right - childBox.width;
    const shift = childAlign === "center" ? slack / 2 : childAlign === "end" ? slack : 0;
    const before = y;
    childBox.x = decoration.inset.left + margin.left + shift;
    childBox.y = y + spacing + margin.top;
    y = childBox.y + childBox.height + margin.bottom;
    box.children.push(childBox);
    placed.push({
      index,
      box: childBox,
      y: before,
      whole: result.state === undefined && !resuming,
    });

    if (result.state !== undefined) {
      next = { index, child: result.state, broke: true };
      break;
    }
    childState = undefined;
    index++;
    if (boxProps(child).break === "after" && index < children.length) {
      next = { index, child: undefined, broke: false };
      break;
    }
  }

  const finished = next === undefined;
  if (!finished && placed.length === 0 && absolutes.length === 0) return { state: next };

  let height = y + (finished ? decoration.inset.bottom : 0);
  if (fixedHeight !== undefined) height = limit;
  else {
    const floor = first ? toPoints(props.minHeight, area.height) : undefined;
    if (floor !== undefined) height = Math.max(height, Math.min(floor, area.height));
    // An unfinished box with a background or border runs to the bottom of the page.
    if (!finished && (props.background !== undefined || props.border !== undefined))
      height = area.height;
  }
  box.height = height;
  decorate(box, node, decoration, { top: !first, bottom: !finished });
  for (const absolute of absolutes) {
    box.children.push(layoutAbsolute(absolute, own, { width, height }, sink));
  }
  return finished ? { box } : { box, state: next };
}

function layoutAbsolute(
  node: LayoutNode<"Absolute">,
  context: TextContext,
  container: { width: number; height: number },
  sink: LayoutSink,
): Box {
  const props = node.props as AbsoluteProps;
  if (props.anchor === "page") container = sink.page;
  const left = props.left;
  const right = props.right;
  const stretched = left !== undefined && right !== undefined && props.width === undefined;
  const room = container.width - (left ?? 0) - (right ?? 0);
  const result = layoutStack(
    stretched ? { ...node, props: { ...props, width: room } } : node,
    context,
    { width: Math.max(0, room), height: Number.POSITIVE_INFINITY, fresh: true, fit: !stretched },
    undefined,
    sink,
  );
  const box = result.box as Box;
  box.x = left ?? (right !== undefined ? container.width - right - box.width : 0);
  box.y =
    props.top ?? (props.bottom !== undefined ? container.height - props.bottom - box.height : 0);
  if (props.rotate) box.rotate = props.rotate;
  if (props.anchor === "page") box.page = true;
  return box;
}

interface RowState {
  widths: number[];
  states: unknown[];
  done: boolean[];
}

/** Shares a row's width among its children by the rules of CSS flexbox (single line). */
function flexWidths(
  children: LayoutNode[],
  context: TextContext,
  inner: number,
  gap: number,
): number[] {
  const items = children.map((child) => {
    const props = child.props as BoxProps & SpacerProps;
    const margin = marginsOf(child);
    const size = measure(child, context);
    const spacer = child.type === "Spacer";
    const explicit = toPoints(props.basis ?? props.width, inner);
    const basis = spacer ? (props.size ?? 0) : (explicit ?? size.max);
    return {
      basis,
      min: explicit !== undefined || spacer ? Math.min(basis, size.min) : size.min,
      grow: props.grow ?? (spacer && props.size === undefined ? 1 : 0),
      shrink: spacer ? 0 : (props.shrink ?? 1),
      margin: margin.left + margin.right,
      width: basis,
      frozen: false,
    };
  });
  const gaps = gap * Math.max(0, children.length - 1);
  const used = (): number => items.reduce((sum, item) => sum + item.width + item.margin, gaps);
  let free = inner - used();
  if (free > 0) {
    const total = items.reduce((sum, item) => sum + item.grow, 0);
    if (total > 0) for (const item of items) item.width += (free * item.grow) / total;
  } else if (free < 0) {
    // Shrink in proportion to size, never below what the content needs; repeat while a child
    // hits its floor and the rest must give up more.
    for (let round = 0; round < items.length && free < -1e-6; round++) {
      const total = items.reduce(
        (sum, item) => sum + (item.frozen ? 0 : item.shrink * item.basis),
        0,
      );
      if (total <= 0) break;
      for (const item of items) {
        if (item.frozen) continue;
        const target = item.width + (free * item.shrink * item.basis) / total;
        if (target <= item.min) {
          item.width = item.min;
          item.frozen = true;
        } else {
          item.width = target;
        }
      }
      free = inner - used();
    }
  }
  return items.map((item) => Math.max(0, item.width));
}

function layoutRow(
  node: LayoutNode<"Row">,
  context: TextContext,
  area: Area,
  state: RowState | undefined,
  sink: LayoutSink,
): LayoutResult {
  const props = node.props as RowProps;
  const own = inherit(context, props);
  const decoration = decorationOf(node, context);
  const first = state === undefined;
  const top = first ? decoration.inset.top : 0;
  const width = widthIn(node, context, area);
  const innerWidth = Math.max(0, width - decoration.inset.left - decoration.inset.right);
  const gap = props.gap ?? 0;
  const align: Align = props.align ?? "stretch";
  const all = normalize(node.children);
  const children = all.filter((child) => child.type !== "Absolute");
  const widths = state?.widths ?? flexWidths(children, own, innerWidth, gap);

  const fixedHeight = first ? toPoints(props.height, area.height) : undefined;
  if (fixedHeight !== undefined && fixedHeight > area.height + 1e-6 && !area.fresh)
    return { state: RETRY };
  const limit = fixedHeight !== undefined ? Math.min(fixedHeight, area.height) : area.height;
  const available = limit - top - decoration.inset.bottom;

  const results = children.map((child, i) => {
    if (state?.done[i]) return undefined;
    const margin = marginsOf(child);
    if (child.type === "Spacer") {
      const spacer: Box = { x: 0, y: 0, width: widths[i] as number, height: 0, children: [] };
      return { box: spacer } as LayoutResult;
    }
    return layout(
      // The flex algorithm has decided the width; the child must not second-guess it.
      { ...child, props: { ...child.props, width: widths[i] as number } } as LayoutNode,
      own,
      {
        width: widths[i] as number,
        height: available - margin.top - margin.bottom,
        fresh: area.fresh,
      },
      state?.states[i],
      sink,
    );
  });
  // If some child cannot start here, the whole row moves on rather than being half drawn.
  if (!area.fresh && first && results.some((result) => result && !result.box))
    return { state: RETRY };

  let rowHeight = 0;
  results.forEach((result, i) => {
    if (!result?.box) return;
    const margin = marginsOf(children[i] as LayoutNode);
    rowHeight = Math.max(rowHeight, result.box.height + margin.top + margin.bottom);
  });
  const unfinished = results.some((result) => result?.state !== undefined);
  if (fixedHeight !== undefined) rowHeight = limit - top - decoration.inset.bottom;
  else if (unfinished) rowHeight = Math.max(rowHeight, available);

  // Spare width goes where `justify` says, unless a child grew to take it.
  const used = widths.reduce(
    (sum, value, i) => {
      const margin = marginsOf(children[i] as LayoutNode);
      return sum + value + margin.left + margin.right;
    },
    gap * Math.max(0, children.length - 1),
  );
  const spare = Math.max(0, innerWidth - used);
  const justify = props.justify ?? "start";
  let x = decoration.inset.left;
  let between = gap;
  if (justify === "center") x += spare / 2;
  else if (justify === "end") x += spare;
  else if (justify === "space-between" && children.length > 1)
    between += spare / (children.length - 1);
  else if (justify === "space-around" && children.length > 0) {
    between += spare / children.length;
    x += spare / children.length / 2;
  }

  const box: Box = { x: 0, y: 0, width, height: 0, children: [] };
  children.forEach((child, i) => {
    const margin = marginsOf(child);
    const result = results[i];
    if (result?.box) {
      const childBox = result.box;
      const childAlign = boxProps(child).alignSelf ?? align;
      const room = rowHeight - margin.top - margin.bottom;
      childBox.x = x + margin.left;
      childBox.y = top + margin.top;
      if (childAlign === "center") childBox.y += (room - childBox.height) / 2;
      else if (childAlign === "end") childBox.y += room - childBox.height;
      else if (childAlign === "stretch" && child.type !== "Image" && child.type !== "Canvas") {
        // Stretched children share the row's height, so their backgrounds line up.
        childBox.height = Math.max(childBox.height, room);
      }
      box.children.push(childBox);
    }
    x += (widths[i] as number) + margin.left + margin.right + between;
  });

  box.height = top + rowHeight + (unfinished ? 0 : decoration.inset.bottom);
  decorate(box, node, decoration, { top: !first, bottom: unfinished });
  for (const child of all) {
    if (child.type === "Absolute") {
      box.children.push(
        layoutAbsolute(child as LayoutNode<"Absolute">, own, { width, height: box.height }, sink),
      );
    }
  }
  if (!unfinished) return { box };
  return {
    box,
    state: {
      widths,
      states: results.map((result) => result?.state),
      done: results.map((result, i) => state?.done[i] === true || result?.state === undefined),
    } satisfies RowState,
  };
}

interface TextState {
  paragraph: ParagraphLayout;
  line: number;
}

function layoutText(
  node: LayoutNode<"Text">,
  context: TextContext,
  area: Area,
  state: TextState | undefined,
  sink: LayoutSink,
): LayoutResult {
  const props = node.props as TextElementProps;
  const own = textContext(node, context);
  const decoration = decorationOf(node, context);
  const first = state === undefined;
  const top = first ? decoration.inset.top : 0;
  const width = widthIn(node, context, area);
  const innerWidth = Math.max(0, width - decoration.inset.left - decoration.inset.right);

  const fitted = props.fit && !state ? fitParagraph(node, context, innerWidth) : undefined;
  const paragraph = state?.paragraph ?? fitted?.paragraph ?? paragraphOf(node, context, innerWidth);
  const box: Box = { x: 0, y: 0, width, height: 0, children: [] };
  if (!paragraph) {
    box.height = decoration.inset.top + decoration.inset.bottom;
    decorate(box, node, decoration, { top: false, bottom: false });
    return { box };
  }
  if (first)
    for (const character of paragraph.missingCharacters) sink.missingCharacters.add(character);

  const lines = paragraph.lines;
  const from = state?.line ?? 0;
  const origin = lines[from]?.top ?? 0;
  const available = area.height - top - decoration.inset.bottom;
  let count = 0;
  while (from + count < lines.length) {
    const line = lines[from + count] as TextLine;
    if (line.top + line.height - origin > available + 1e-6) break;
    count++;
  }
  const remaining = lines.length - from;
  if (count < remaining) {
    // Do not strand a line or two on either side of the break.
    const physical = count;
    count = Math.min(count, remaining - own.widows);
    if (count < own.orphans) count = 0;
    if (count <= 0) {
      if (!area.fresh) return { state: state ?? RETRY };
      // Nowhere better to go: take what fits, and at least one line.
      count = Math.max(1, physical);
    }
  }
  const shown = lines.slice(from, from + count);
  const last = shown.at(-1);
  const textHeight = last ? last.top + last.height - origin : 0;
  const finished = from + count >= lines.length;
  box.height = top + textHeight + (finished ? decoration.inset.bottom : 0);
  box.text = { lines: shown, x: decoration.inset.left + (fitted?.offset ?? 0), y: top - origin };
  decorate(box, node, decoration, { top: !first, bottom: !finished });
  return finished ? { box } : { box, state: { paragraph, line: from + count } satisfies TextState };
}

function layoutImage(node: LayoutNode<"Image">, context: TextContext, area: Area): LayoutResult {
  const props = node.props as ImageProps;
  const decoration = decorationOf(node, context);
  const image = imageOf(props.src);
  const natural = orientedSize(image);
  const horizontal = decoration.inset.left + decoration.inset.right;
  const vertical = decoration.inset.top + decoration.inset.bottom;
  const ratio = natural.width / natural.height;

  let width = toPoints(props.width, area.width);
  let height = toPoints(props.height, Number.isFinite(area.height) ? area.height : 0);
  const both = width !== undefined && height !== undefined;
  if (width !== undefined) width = Math.max(0, width - horizontal);
  if (height !== undefined) height = Math.max(0, height - vertical);
  if (width === undefined && height === undefined) {
    // No size given: natural size, shrunk to the space there is.
    width = Math.min(natural.width * PX, Math.max(0, area.width - horizontal));
    height = width / ratio;
  } else if (width === undefined) width = (height as number) * ratio;
  else if (height === undefined) height = width / ratio;
  let boxWidth = width as number;
  let boxHeight = height as number;

  if (boxHeight + vertical > area.height + 1e-6) {
    if (!area.fresh) return { state: RETRY };
    // Taller than a whole page: scale it down to fit.
    const scale = Math.max(0, area.height - vertical) / boxHeight;
    boxHeight *= scale;
    if (!both) boxWidth *= scale;
  }

  // Where the picture itself goes inside the content box.
  let drawWidth = boxWidth;
  let drawHeight = boxHeight;
  const fit = props.fit ?? "contain";
  if (both && fit !== "fill") {
    const scale =
      fit === "cover"
        ? Math.max(boxWidth / natural.width, boxHeight / natural.height)
        : Math.min(boxWidth / natural.width, boxHeight / natural.height);
    drawWidth = natural.width * scale;
    drawHeight = natural.height * scale;
  }
  const box: Box = {
    x: 0,
    y: 0,
    width: boxWidth + horizontal,
    height: boxHeight + vertical,
    children: [],
    image: {
      image,
      x: decoration.inset.left + (boxWidth - drawWidth) / 2,
      y: decoration.inset.top + (boxHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
      clip: drawWidth > boxWidth + 1e-6 || drawHeight > boxHeight + 1e-6,
    },
  };
  decorate(box, node, decoration, { top: false, bottom: false });
  return { box };
}

function layoutGrid(
  node: LayoutNode<"Grid">,
  context: TextContext,
  area: Area,
  state: { index: number } | undefined,
  sink: LayoutSink,
): LayoutResult {
  const props = node.props as GridProps;
  const own = inherit(context, props);
  const decoration = decorationOf(node, context);
  const first = state === undefined;
  const top = first ? decoration.inset.top : 0;
  const width = widthIn(node, context, area);
  const innerWidth = Math.max(0, width - decoration.inset.left - decoration.inset.right);
  const [rowGap, columnGap] = Array.isArray(props.gap)
    ? (props.gap as readonly [number, number])
    : [(props.gap as number | undefined) ?? 0, (props.gap as number | undefined) ?? 0];
  const columns = Math.max(1, Math.floor(props.columns));
  const cellWidth = props.cell.width ?? (innerWidth - columnGap * (columns - 1)) / columns;
  const cellHeight = props.cell.height;
  const children = normalize(node.children);
  const from = state?.index ?? 0;

  const available = area.height - top - decoration.inset.bottom;
  let rows = Math.floor((available + rowGap + 1e-6) / (cellHeight + rowGap));
  if (props.rows !== undefined) rows = Math.min(rows, props.rows);
  if (rows < 1) {
    if (!area.fresh) return { state: state ?? RETRY };
    rows = 1;
  }
  const count = Math.min(children.length - from, rows * columns);
  const box: Box = { x: 0, y: 0, width, height: 0, children: [] };
  for (let i = 0; i < count; i++) {
    const cell = layout(
      children[from + i] as LayoutNode,
      own,
      { width: cellWidth, height: cellHeight, fresh: true },
      undefined,
      sink,
    ).box;
    if (!cell) continue;
    cell.x = decoration.inset.left + (i % columns) * (cellWidth + columnGap);
    cell.y = top + Math.floor(i / columns) * (cellHeight + rowGap);
    box.children.push(cell);
  }
  const usedRows = Math.ceil(count / columns);
  const finished = from + count >= children.length;
  box.height =
    top +
    usedRows * cellHeight +
    Math.max(0, usedRows - 1) * rowGap +
    (finished ? decoration.inset.bottom : 0);
  decorate(box, node, decoration, { top: !first, bottom: !finished });
  return finished ? { box } : { box, state: { index: from + count } };
}

function layoutCanvas(node: LayoutNode<"Canvas">, context: TextContext, area: Area): LayoutResult {
  const props = node.props as CanvasProps;
  const decoration = decorationOf(node, context);
  const width = widthIn(node, context, area);
  const height = props.height + decoration.inset.top + decoration.inset.bottom;
  if (height > area.height + 1e-6 && !area.fresh) return { state: RETRY };
  const box: Box = {
    x: 0,
    y: 0,
    width,
    height,
    children: [],
    canvas: {
      draw: props.draw,
      color: inherit(context, props).color,
      x: decoration.inset.left,
      y: decoration.inset.top,
      width: Math.max(0, width - decoration.inset.left - decoration.inset.right),
      height: props.height,
    },
  };
  decorate(box, node, decoration, { top: false, bottom: false });
  return { box };
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

/** The marker of a list item, for the built-in numbering styles. */
export function listMarker(style: string, number: number): string {
  switch (style) {
    case "disc":
      return "\u2022";
    case "dash":
      return "\u2013";
    case "decimal":
      return `${number}.`;
    case "lower-alpha":
    case "upper-alpha": {
      // a … z, aa, ab, …
      let text = "";
      for (let n = Math.max(1, number); n > 0; n = Math.floor((n - 1) / 26)) {
        text = String.fromCharCode(97 + ((n - 1) % 26)) + text;
      }
      return `${style === "upper-alpha" ? text.toUpperCase() : text}.`;
    }
    case "lower-roman":
    case "upper-roman": {
      let text = "";
      let rest = Math.max(1, Math.min(3999, number));
      for (const [value, numeral] of ROMAN) {
        while (rest >= value) {
          text += numeral;
          rest -= value;
        }
      }
      return `${style === "upper-roman" ? text.toUpperCase() : text}.`;
    }
    default:
      return style;
  }
}

const expandedLists: WeakMap<LayoutNode, Map<TextContext, LayoutNode>> = new WeakMap();

/** A list is a stack of rows: a right-aligned marker, then the item. */
function expandList(node: LayoutNode<"List">, context: TextContext): LayoutNode {
  let byContext = expandedLists.get(node);
  if (!byContext) {
    byContext = new Map();
    expandedLists.set(node, byContext);
  }
  const cached = byContext.get(context);
  if (cached) return cached;

  const props = node.props as ListProps;
  const own = inherit(context, props);
  const { marker, start, gap, markerGap, markerWidth, splitItems, ...box } = props;
  const items = normalize(node.children);
  const markers = items.map((_item, i) => {
    const number = (start ?? 1) + i;
    return typeof marker === "function" ? marker(number) : listMarker(marker ?? "disc", number);
  });
  const markerNodes = markers.map(
    (text): LayoutNode => ({ type: "Text", props: { align: "right" }, children: [text] }),
  );
  const width =
    markerWidth ?? Math.max(0, ...markerNodes.map((markerNode) => measure(markerNode, own).max));
  const expanded: LayoutNode = {
    type: "Stack",
    props: { ...box, ...(gap !== undefined ? { gap } : {}) },
    children: items.map(
      (item, i): LayoutNode => ({
        type: "Row",
        props: {
          gap: markerGap ?? own.size / 2,
          align: "start",
          ...(splitItems ? {} : { keepTogether: true }),
        },
        children: [
          { ...(markerNodes[i] as LayoutNode), props: { align: "right", width, shrink: 0 } },
          { type: "Stack", props: { grow: 1, basis: 0 }, children: [item] },
        ],
      }),
    ),
  };
  byContext.set(context, expanded);
  return expanded;
}

function layoutQrCode(node: LayoutNode<"QrCode">, context: TextContext, area: Area): LayoutResult {
  const props = node.props as QrCodeProps;
  const decoration = decorationOf(node, context);
  const size = props.size ?? 72;
  const height = size + decoration.inset.top + decoration.inset.bottom;
  if (height > area.height + 1e-6 && !area.fresh) return { state: RETRY };
  const code = qrCode(props.value, props.level ? { level: props.level } : {});
  const quiet = Math.max(0, props.quiet ?? 4);
  const module = size / (code.size + quiet * 2);
  const box: Box = {
    x: 0,
    y: 0,
    width: size + decoration.inset.left + decoration.inset.right,
    height,
    children: [],
    canvas: {
      // All dark modules go into one path: runs along each row become rectangles.
      draw: (g) => {
        for (let y = 0; y < code.size; y++) {
          const row = code.modules[y] as readonly boolean[];
          for (let x = 0; x < code.size; x++) {
            if (!row[x]) continue;
            let end = x;
            while (end + 1 < code.size && row[end + 1]) end++;
            g.rect((quiet + x) * module, (quiet + y) * module, (end - x + 1) * module, module);
            x = end;
          }
        }
        g.fill();
      },
      color: props.color === undefined ? inherit(context, props).color : toColor(props.color),
      x: decoration.inset.left,
      y: decoration.inset.top,
      width: size,
      height: size,
    },
  };
  decorate(box, node, decoration, { top: false, bottom: false });
  return { box };
}

/**
 * Lays out one element in an area.
 *
 * @param state what a previous call returned, to continue the element on a new page
 */
export function layout(
  node: LayoutNode,
  context: TextContext,
  area: Area,
  state: unknown,
  sink: LayoutSink,
): LayoutResult {
  const resume = state === RETRY ? undefined : state;
  switch (node.type) {
    case "Stack":
      return layoutStack(node, context, area, resume as StackState | undefined, sink);
    case "Row":
      return layoutRow(
        node as LayoutNode<"Row">,
        context,
        area,
        resume as RowState | undefined,
        sink,
      );
    case "Text":
      return layoutText(
        node as LayoutNode<"Text">,
        context,
        area,
        resume as TextState | undefined,
        sink,
      );
    case "Image":
      return layoutImage(node as LayoutNode<"Image">, context, area);
    case "Grid":
      return layoutGrid(
        node as LayoutNode<"Grid">,
        context,
        area,
        resume as { index: number } | undefined,
        sink,
      );
    case "Canvas":
      return layoutCanvas(node as LayoutNode<"Canvas">, context, area);
    case "Table":
      return layoutTable(node as LayoutNode<"Table">, context, area, resume as never, sink);
    case "List":
      return layoutStack(
        expandList(node as LayoutNode<"List">, context),
        context,
        area,
        resume as StackState | undefined,
        sink,
      );
    case "QrCode":
      return layoutQrCode(node as LayoutNode<"QrCode">, context, area);
    case "TableRow":
    case "Cell":
      throw new LayoutError(`${node.type} belongs inside a Table`);
    case "Spacer": {
      const size = (node as LayoutNode<"Spacer">).props.size ?? 0;
      if (size > area.height + 1e-6 && !area.fresh) return { state: RETRY };
      return {
        box: {
          x: 0,
          y: 0,
          width: 0,
          height: Math.min(size, Math.max(0, area.height)),
          children: [],
        },
      };
    }
    case "Span":
      throw new LayoutError("Span and Link belong inside a Text element");
    case "Absolute":
    case "PageBreak":
      // Both are handled by the container they sit in.
      return { box: { x: 0, y: 0, width: 0, height: 0, children: [] } };
    default:
      throw new LayoutError(`${(node as LayoutNode).type} cannot be used here`);
  }
}
