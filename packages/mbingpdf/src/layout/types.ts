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
  /** A name for this element that `Link({ to })` can point to. Must be unique in the document. */
  id?: string;
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
  /**
   * Keeps the text on one line and sizes it to fill the width of its box, between `min` and
   * `max` points: a name on a certificate, a number on a bib. `true` shrinks from the current
   * size only when needed. Text that is still too wide at `min` overflows.
   */
  fit?: boolean | { readonly min?: number; readonly max?: number };
}

export type ListMarker =
  | "disc"
  | "dash"
  | "decimal"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman";

export interface ListProps extends BoxProps {
  /**
   * What goes in front of each item: a bullet (`"disc"`, default), a numbering style, any
   * string, or a function of the item's number.
   */
  marker?: ListMarker | (string & {}) | ((number: number) => string);
  /** The number of the first item. Default 1. */
  start?: number;
  /** Space between items. */
  gap?: number;
  /** Space between a marker and its item. Default: half the font size. */
  markerGap?: number;
  /** Width set aside for markers. Default: the width of the widest marker. */
  markerWidth?: number;
  /** Allow an item to be split across pages. By default each item stays whole. */
  splitItems?: boolean;
}

export interface QrCodeProps extends BoxProps {
  /** The text to encode, usually a web address. */
  value: string;
  /** Width and height of the code in points, including its quiet zone. Default 72. */
  size?: number;
  /** Error correction, from `"L"` (least) to `"H"` (most). Default `"M"`. */
  level?: "L" | "M" | "Q" | "H";
  /**
   * Width of the empty border scanners need around a code, in modules. Default 4, as the
   * standard requires; set 0 when the layout already leaves that much white around it.
   */
  quiet?: number;
  /** Colour of the dark modules. Default: the text colour. Keep it dark on a light ground. */
  color?: ColorInput;
}

/** Properties of a stretch of text inside a `Text`. */
export interface SpanProps extends TextProps {
  /** Makes the span a link to this address. */
  href?: string;
  /** Makes the span a link to the element in this document with this `id`. */
  to?: string;
}

export interface HeadingProps extends TextElementProps {
  /** 1 for a chapter title, 2 for a section, and so on to 6. Default 1. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Whether the heading appears in the PDF's bookmarks and in a `TableOfContents`. Default
   * true. A string gives a different title to show there.
   */
  bookmark?: boolean | string;
}

export interface TableOfContentsProps extends BoxProps {
  /** The heading levels to list, lowest and highest. Default `[1, 3]`. */
  levels?: readonly [from: number, to: number];
  /** How far each level is indented from the one above, in points. Default 12. */
  indent?: number;
  /** Space between entries. */
  gap?: number;
  /** Draw a dotted line from each title to its page number. Default true. */
  leaders?: boolean;
}

export interface ColumnsProps extends BoxProps {
  /** Number of columns. Default 2. */
  count?: number;
  /** Space between columns. Default 12 points. */
  gap?: number;
  /** Space between the children as they flow down the columns. */
  rowGap?: number;
  /** A line between columns. */
  rule?: BorderSide;
  /** Make the columns the same height where the content ends. Default true. */
  balance?: boolean;
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

/** A column of a table. */
export interface TableColumn extends TextProps {
  /**
   * A fixed width in points, a percentage of the table, a share of the leftover width
   * (`"1fr"`, `"2fr"`), or `"auto"` for as wide as its content. Default `"1fr"`.
   */
  width?: number | `${number}%` | `${number}fr` | "auto";
  /** Alignment of text in this column's cells. */
  align?: TextAlign | "start" | "end";
}

export interface CellProps extends BoxProps {
  /** Number of columns the cell covers. Default 1. */
  colSpan?: number;
  /** Alignment of text in the cell; overrides the column's. */
  align?: TextAlign | "start" | "end";
  /** Where the content sits when the row is taller than it. Default `"top"`. */
  verticalAlign?: "top" | "middle" | "bottom";
}

export interface TableRowProps extends TextProps {
  background?: ColorInput;
  /** The least height of the row. */
  height?: number;
  /** Keeps this row on the same page as the next one (a group title with its first line). */
  keepWithNext?: boolean;
}

/** A row of a table: a list of cells, or a `TableRow` when the row needs properties. */
export type TableRowInput = readonly Child[] | LayoutNode<"TableRow">;

/** The lines of a table. */
export interface TableBorders {
  /** Around the table. */
  outer?: BorderSide;
  /** Between rows. */
  horizontal?: BorderSide;
  /** Between columns. */
  vertical?: BorderSide;
  /** Under the header; default: the same as `horizontal`. */
  header?: BorderSide;
  /** Above the footer; default: the same as `horizontal`. */
  footer?: BorderSide;
}

/** Style of the header or footer rows of a table. */
export interface TableSectionStyle extends TextProps {
  background?: ColorInput;
}

export interface TableProps extends BoxProps {
  /** The columns, or just how many there are. */
  columns: number | readonly (TableColumn | number | `${number}%` | `${number}fr` | "auto")[];
  /** One header row or several. */
  header?: TableRowInput | readonly TableRowInput[];
  rows: readonly TableRowInput[];
  /** One footer row or several, shown after the last row. */
  footer?: TableRowInput | readonly TableRowInput[];
  /** Repeat the header at the top of every page the table runs onto. Default true. */
  repeatHeader?: boolean;
  /** Repeat the footer at the bottom of every page, not only after the last row. */
  repeatFooter?: boolean;
  /** Space inside every cell. Default 4 points above and below, 6 at the sides. */
  cellPadding?: Edges;
  /**
   * The lines to draw: `"rows"` (default) between rows, `"grid"` around every cell, `"none"`,
   * or each kind of line separately.
   */
  borders?: "rows" | "grid" | "none" | TableBorders;
  /** Background of every second body row. */
  zebra?: ColorInput;
  headerStyle?: TableSectionStyle;
  footerStyle?: TableSectionStyle;
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
  /** Colour of the sheet. With a bleed, it runs to the edge of the bleed. */
  fill?: ColorInput;
  /**
   * For work that is trimmed after printing: how far the artwork may run past the cut line,
   * typically 3 mm. `size` stays the finished size; the `background` is laid out across the
   * bleed as well, so a full-bleed design simply fills it.
   */
  bleed?: number;
  /** Printer's marks outside the bleed: crop marks at the corners, registration targets. */
  marks?: boolean | { readonly crop?: boolean; readonly registration?: boolean };
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
  Table: TableProps;
  TableRow: TableRowProps;
  Cell: CellProps;
  List: ListProps;
  QrCode: QrCodeProps;
  Heading: HeadingProps;
  TableOfContents: TableOfContentsProps;
  Columns: ColumnsProps;
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
