/**
 * Element functions. Each returns plain data describing one piece of a document; `render`
 * does the work. Properties are optional everywhere, so `Text("Hello")` and
 * `Stack([a, b])` are valid.
 */
import type {
  AbsoluteProps,
  CanvasProps,
  CellProps,
  Child,
  DocumentProps,
  GridProps,
  ImageProps,
  LayoutNode,
  ListProps,
  NodeType,
  PageProps,
  QrCodeProps,
  RowProps,
  SpacerProps,
  SpanProps,
  StackProps,
  TableProps,
  TableRowProps,
  TextElementProps,
} from "./types.ts";

function isProps(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    // An element is not a property bag.
    !("type" in value && "props" in value && "children" in value)
  );
}

/** Builds an element from `(props, ...children)` or just `(...children)`. */
function element<T extends NodeType>(type: T, args: readonly unknown[]): LayoutNode<T> {
  const [first, ...rest] = args;
  const hasProps = isProps(first);
  return {
    type,
    props: (hasProps ? first : {}) as LayoutNode<T>["props"],
    children: (hasProps ? rest : args) as Child[],
  };
}

type Args<P> = [props: P, ...children: Child[]] | Child[];

/** The whole document. Text properties set here are the defaults for everything inside. */
export function Document(...args: Args<DocumentProps>): LayoutNode<"Document"> {
  return element("Document", args);
}

/**
 * A run of pages with one size, margin, header and footer. Its children flow down the page
 * and onto as many further pages as they need.
 */
export function Page(...args: Args<PageProps>): LayoutNode<"Page"> {
  return element("Page", args);
}

/** Children one below another. */
export function Stack(...args: Args<StackProps>): LayoutNode<"Stack"> {
  return element("Stack", args);
}

/** A stack by another name, for when the point is the box (padding, border, background). */
export function Box(...args: Args<StackProps>): LayoutNode<"Stack"> {
  return element("Stack", args);
}

/** Children side by side, sharing the width as in CSS flexbox. */
export function Row(...args: Args<RowProps>): LayoutNode<"Row"> {
  return element("Row", args);
}

/** A paragraph. Children are strings and `Span`s; line feeds in a string start a new line. */
export function Text(...args: Args<TextElementProps>): LayoutNode<"Text"> {
  return element("Text", args);
}

/** A stretch of text inside a `Text` with its own style. */
export function Span(...args: Args<SpanProps>): LayoutNode<"Span"> {
  return element("Span", args);
}

/** A stretch of text that links to a web address. */
export function Link(
  props: SpanProps & { href: string },
  ...children: Child[]
): LayoutNode<"Span"> {
  return element("Span", [props, ...children]);
}

/** A picture. Give a width or a height and the other follows from its proportions. */
export function Image(props: ImageProps): LayoutNode<"Image"> {
  return element("Image", [props]);
}

/** Empty space: a fixed gap, or in a `Row` whatever width is left over. */
export function Spacer(props: SpacerProps | number = {}): LayoutNode<"Spacer"> {
  return element("Spacer", [typeof props === "number" ? { size: props } : props]);
}

/** Cells of a fixed size, filled row by row and continued on new pages: labels, bibs, cards. */
export function Grid(props: GridProps, ...children: Child[]): LayoutNode<"Grid"> {
  return element("Grid", [props, ...children]);
}

/** Content placed at fixed distances from the edges of its container or the page. */
export function Absolute(props: AbsoluteProps, ...children: Child[]): LayoutNode<"Absolute"> {
  return element("Absolute", [props, ...children]);
}

/** A region you draw in yourself: charts, diagrams, decorations. */
export function Canvas(props: CanvasProps): LayoutNode<"Canvas"> {
  return element("Canvas", [props]);
}

/** Ends the page; what follows starts on the next one. */
export function PageBreak(): LayoutNode<"PageBreak"> {
  return { type: "PageBreak", props: {}, children: [] };
}

/**
 * Rows and columns of data. A table runs over as many pages as it needs, never splits a row,
 * and repeats its header on each page.
 */
export function Table(props: TableProps): LayoutNode<"Table"> {
  return element("Table", [props]);
}

/** A table row with properties of its own: a background, text style, or `keepWithNext`. */
export function TableRow(...args: Args<TableRowProps>): LayoutNode<"TableRow"> {
  return element("TableRow", args);
}

/** A table cell with properties of its own: a column span, padding, background, alignment. */
export function Cell(...args: Args<CellProps>): LayoutNode<"Cell"> {
  return element("Cell", args);
}

/**
 * A bulleted or numbered list. Each child is an item: a string, or any element (including
 * another `List`).
 */
export function List(...args: Args<ListProps>): LayoutNode<"List"> {
  return element("List", args);
}

/** A QR code, drawn as vector shapes so that it prints sharply at any size. */
export function QrCode(props: QrCodeProps): LayoutNode<"QrCode"> {
  return element("QrCode", [props]);
}
