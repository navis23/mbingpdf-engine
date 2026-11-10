/**
 * The document tree: plain data that describes a document. Element functions build it; the
 * layout engine reads it. Nothing here does any work.
 */
import type { Color, PdfImage } from "../core/index.ts";
import type { Hyphenator, TextAlign, TextFont, TextTransform } from "../text/index.ts";
import type { CanvasContext } from "./canvas.ts";

/** A size in points, or a percentage of the space available: `120` or `"50%"`. */
export type Length = number | `${number}%`;

/** A colour object from `rgb()`, `cmyk()` or `gray()`, or a hex string such as `"#0F62FE"`. */
export type ColorInput = Color | string;

/**
 * Space on the four sides of a box: one number for all sides, `[vertical, horizontal]`,
 * `[top, right, bottom, left]`, or an object naming the sides.
 */
export type Edges =
  | number
  | readonly [vertical: number, horizontal: number]
  | readonly [top: number, right: number, bottom: number, left: number]
  | {
      readonly top?: number;
      readonly right?: number;
      readonly bottom?: number;
      readonly left?: number;
    };

export interface BorderSide {
  /** Line thickness in points. */
  readonly width: number;
  /** Default: the text colour. */
  readonly color?: ColorInput;
}

/** One border for all sides, or a border per side. */
export type Border =
  | BorderSide
  | {
      readonly top?: BorderSide;
      readonly right?: BorderSide;
      readonly bottom?: BorderSide;
      readonly left?: BorderSide;
    };

/** How children are placed across a container's main direction. */
export type Align = "start" | "center" | "end" | "stretch";
export type Justify = "start" | "center" | "end" | "space-between" | "space-around";

/** Text properties. Set on any element, they apply to all text inside it. */
export interface TextProps {
  /** A font, or a list to fall back through for characters the first one lacks. */
  font?: TextFont | readonly TextFont[];
  /** Font size in points. */
  size?: number;
  color?: ColorInput;
  /** Distance between baselines as a multiple of the font size. */
  lineHeight?: number;
  /** Extra space after each character, in points. */
  letterSpacing?: number;
  /** Extra space after each word space, in points. */
  wordSpacing?: number;
  textAlign?: TextAlign;
  /** OpenType features: `{ tnum: true }`. */
  features?: Readonly<Record<string, boolean | number>>;
  transform?: TextTransform;
  /** Splits long words at line ends, such as `hyphenateIndonesian`. */
  hyphenate?: Hyphenator;
  underline?: boolean;
  strikethrough?: boolean;
  /** Fewest lines of a paragraph that may be left at the bottom of a page. Default 2. */
  orphans?: number;
  /** Fewest lines of a paragraph that may be carried to the top of a page. Default 2. */
  widows?: number;
}

/** Box properties shared by every element that takes up space. */
export interface BoxProps extends TextProps {
  /** Space outside the border. */
  margin?: Edges;
  /** Space between the border and the content. */
  padding?: Edges;
  border?: Border;
  background?: ColorInput;
  /** Corner radius of the background and border. */
  radius?: number;
  width?: Length;
  height?: Length;
  minWidth?: Length;
  maxWidth?: Length;
  minHeight?: Length;
  /** 0 is transparent, 1 opaque. Applies to the element and everything in it. */
  opacity?: number;
  /** In a `Row`: share of the spare width this element takes. */
  grow?: number;
  /** In a `Row`: how readily this element gives up width when space is short. Default 1. */
  shrink?: number;
  /** In a `Row`: the width to start from before growing or shrinking. */
  basis?: Length;
  /** Overrides the container's `align` for this element. */
  alignSelf?: Align;
  /**
   * Page breaks: `"before"` starts the element on a new page, `"after"` ends the page after
   * it, `"avoid"` keeps it in one piece (the same as `keepTogether`).
   */
  break?: "before" | "after" | "avoid";
  /** Moves the whole element to the next page rather than splitting it. */
  keepTogether?: boolean;
  /** Keeps this element on the same page as the start of the next one (for headings). */
  keepWithNext?: boolean;
}

export interface StackProps extends BoxProps {
  /** Space between children. */
  gap?: number;
  /** How children sit across the stack. Default `"stretch"`: each fills the width. */
  align?: Align;
}

export interface RowProps extends BoxProps {
  /** Space between children. */
  gap?: number;
  /** How children sit across the row's height. Default `"stretch"`. */
  align?: Align;
  /** How spare width is shared out when no child grows. Default `"start"`. */
  justify?: Justify;
}

export interface TextElementProps extends BoxProps {
  /** Alignment of the text in its box. */
  align?: TextAlign;
}

/** Properties of a stretch of text inside a `Text`. */
export interface SpanProps extends TextProps {
  /** Makes the span a link to this address. */
  href?: string;
}

export interface ImageProps extends BoxProps {
  /** A decoded image, or the bytes of a JPEG or PNG file. */
  src: PdfImage | Uint8Array;
  /**
   * How the picture fills a box whose proportions differ from its own, when both width and
   * height are given: `"contain"` (default) fits it inside, `"cover"` fills and crops,
   * `"fill"` stretches.
   */
  fit?: "contain" | "cover" | "fill";
}

export interface SpacerProps {
  /** The gap in points. Without it, a spacer in a `Row` takes all spare width. */
  size?: number;
  grow?: number;
}

export interface GridProps extends BoxProps {
  /** Number of cells across. */
  columns: number;
  /** Size of each cell. The width defaults to an equal share of the grid's width. */
  cell: { readonly width?: number; readonly height: number };
  /** Space between cells: one number, or `[betweenRows, betweenColumns]`. */
  gap?: number | readonly [row: number, column: number];
  /** Cells down per page. Default: as many as fit. */
  rows?: number;
}

export interface AbsoluteProps extends BoxProps {
  /** Distances from the edges of the containing box (or the page). */
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  /** Clockwise rotation in degrees about the centre of the element. */
  rotate?: number;
  /** What the distances are measured from. Default `"parent"`: the containing element. */
  anchor?: "parent" | "page";
}

export interface CanvasProps extends BoxProps {
  width: Length;
  height: number;
  /** Draws into the canvas. Coordinates start at its top-left corner; y grows downward. */
  draw: (g: CanvasContext, size: { width: number; height: number }) => void;
}

/** What page furniture is told about the page it is on. */
export interface PageInfo {
  /** Page number, counting from 1 across the whole document. */
  readonly page: number;
  /** Total number of pages in the document. */
  readonly pages: number;
}

/** A named paper size, or `[width, height]` in points. */
export type PageSizeInput =
  | "A3"
  | "A4"
  | "A5"
  | "A6"
  | "Letter"
  | "Legal"
  | readonly [number, number];

export interface PageProps extends Omit<TextProps, "size"> {
  /** The paper size. Default `"A4"`. */
  size?: PageSizeInput;
  /** Font size for the text on these pages (`size` is taken by the paper). */
  fontSize?: number;
  /** Default `"portrait"`. */
  orientation?: "portrait" | "landscape";
  /** Space between the paper's edge and the content. Default 20 mm. */
  margin?: Edges;
  /** Repeated at the top of every page. */
  header?: Child | ((info: PageInfo) => Child);
  /** Repeated at the bottom of every page. */
  footer?: Child | ((info: PageInfo) => Child);
  /**
   * Drawn behind the content of every page, across the whole sheet: letterheads, watermarks,
   * frames. `Absolute` children are positioned against the page.
   */
  background?: Child | ((info: PageInfo) => Child);
  /** Colour of the sheet. */
  fill?: ColorInput;
  /** Space between children. */
  gap?: number;
}

export interface DocumentProps extends TextProps {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  /** The application that made the document. */
  creator?: string;
  /** Language of the text, as a BCP 47 tag such as `"id"` or `"en-GB"`. */
  lang?: string;
}

interface PropsByType {
  Document: DocumentProps;
  Page: PageProps;
  Stack: StackProps;
  Row: RowProps;
  Text: TextElementProps;
  Span: SpanProps;
  Image: ImageProps;
  Spacer: SpacerProps;
  Grid: GridProps;
  Absolute: AbsoluteProps;
  Canvas: CanvasProps;
  PageBreak: Record<string, never>;
}

export type NodeType = keyof PropsByType;

/** One element of a document. */
export interface LayoutNode<T extends NodeType = NodeType> {
  readonly type: T;
  readonly props: PropsByType[T];
  readonly children: readonly Child[];
}

/**
 * Anything that may appear in a list of children. Strings and numbers are text; `null`,
 * `undefined` and `false` are skipped, so `condition && Text(...)` works.
 */
export type Child = LayoutNode | string | number | null | undefined | false | readonly Child[];
