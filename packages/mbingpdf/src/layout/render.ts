/** From a document tree to pages, and from pages to a PDF file. */
import { type OutputIntent, orientedSize, PdfDocument } from "../core/index.ts";
import type { DisplayItem, DisplayPage } from "./display.ts";
import {
  type Box,
  LayoutError,
  type LayoutSink,
  layout,
  normalize,
  type TocEntry,
} from "./engine.ts";
import { paintBox } from "./paint.ts";
import { writeDisplayPage } from "./pdf.ts";
import {
  DEFAULT_TEXT,
  inherit,
  type TextContext,
  toColor,
  toPageSize,
  toSides,
  useTheme,
} from "./style.ts";
import type { Child, DocumentProps, LayoutNode, PageInfo, PageProps } from "./types.ts";

export interface LayoutWarning {
  /** What kind of problem this is. */
  readonly code: "missing-glyph" | "low-resolution-image";
  readonly message: string;
  /** Where in the document the problem was first met: `Document > Page[0] > Text[2]`. */
  readonly path?: string;
}

export interface RenderOptions {
  /**
   * Leave the creation date out, so the same document always gives the same bytes. Useful for
   * tests and for caching.
   */
  deterministic?: boolean;
  /** Compress the file's contents. Default true. */
  compress?: boolean;
  /** Called for problems that do not stop the document from being made. */
  onWarning?: (warning: LayoutWarning) => void;
  /**
   * A standard the file must meet. `"PDF/X-4"`, for commercial printing, needs an
   * `outputIntent`, embedded fonts throughout, and is checked when the file is written.
   */
  conformance?: "PDF/X-4";
  /** The printing condition the document is prepared for: an ICC profile and its name. */
  outputIntent?: OutputIntent;
  /** Warn about images that would print below this resolution, such as 300. */
  minImageDpi?: number;
  /** Treat warnings as errors: the first one stops the render. */
  strict?: boolean;
  /** Outline every element's box, to see how a layout is put together. */
  debug?: boolean;
}

/** The result of laying out a document: its pages, ready for any backend. */
export interface DocumentLayout {
  readonly pages: readonly DisplayPage[];
  readonly warnings: readonly LayoutWarning[];
}

const MM = 72 / 25.4;

interface PlannedPage {
  page: LayoutNode<"Page">;
  context: TextContext;
  width: number;
  height: number;
  body: Box | undefined;
}

/** Wraps page furniture, given as content or as a function of the page number, in a stack. */
function furniture(
  source: Child | ((info: PageInfo) => Child) | undefined,
  info: PageInfo,
): LayoutNode | undefined {
  if (source === undefined || source === null || typeof source === "boolean") return undefined;
  const content = typeof source === "function" ? source(info) : source;
  if (content === undefined || content === null || typeof content === "boolean") return undefined;
  return { type: "Stack", props: {}, children: [content] };
}

/** Lays out a document into pages of drawing instructions, without writing a file. */
export function layoutDocument(
  document: LayoutNode,
  options: { minImageDpi?: number; debug?: boolean } = {},
): DocumentLayout {
  if (document?.type !== "Document") throw new LayoutError("render() needs a Document element");
  // A table of contents shows page numbers that are only known once the document is laid out,
  // and its own length can move those pages. So: lay out, read off the headings, and repeat
  // until the page numbers stop changing (twice is the usual case).
  let toc: TocEntry[] = [];
  let result = layoutPass(document, options, toc);
  for (let pass = 0; pass < 5 && result.usesToc; pass++) {
    const same =
      toc.length === result.headings.length &&
      toc.every(
        (entry, i) =>
          entry.id === result.headings[i]?.id && entry.page === result.headings[i]?.page,
      );
    if (same) break;
    toc = result.headings;
    result = layoutPass(document, options, toc);
  }
  return { pages: result.pages, warnings: result.warnings };
}

/** One run of layout, given the headings found by the run before. */
function layoutPass(
  document: LayoutNode,
  options: {
    minImageDpi?: number;
    debug?: boolean;
    onBoxes?: (page: number, boxes: InspectedBox[]) => void;
  },
  toc: readonly TocEntry[],
  consume?: (page: DisplayPage) => void,
): DocumentLayout & { usesToc: boolean; headings: TocEntry[] } {
  const lowResolution: string[] = [];
  const sink: LayoutSink = {
    missingCharacters: new Map(),
    path: ["Document"],
    page: { width: 0, height: 0 },
    toc,
    headingCount: 0,
    usesToc: false,
  };
  // The theme's "body" style, if it has one, is the document's default text.
  const theme = (document.props as DocumentProps).theme;
  useTheme(theme);
  const themed: TextContext = { ...DEFAULT_TEXT, theme };
  const { theme: _theme, ...documentText } = document.props as DocumentProps;
  const base = inherit(
    theme?.text?.body ? inherit(themed, { style: "body" }) : themed,
    documentText,
  );

  // Anything that is not a Page is put on a default page, so small documents need no ceremony.
  const sections: LayoutNode<"Page">[] = [];
  let loose: LayoutNode[] = [];
  const flush = (): void => {
    if (loose.length > 0) sections.push({ type: "Page", props: {}, children: loose });
    loose = [];
  };
  for (const child of normalize(document.children)) {
    if (child.type === "Page") {
      flush();
      sections.push(child as LayoutNode<"Page">);
    } else loose.push(child);
  }
  flush();
  if (sections.length === 0) sections.push({ type: "Page", props: {}, children: [] });

  const measureIn = (
    node: LayoutNode | undefined,
    context: TextContext,
    width: number,
    height: number,
  ): Box | undefined =>
    node ? layout(node, context, { width, height, fresh: true }, undefined, sink).box : undefined;

  // First pass: flow each section's content onto as many pages as it needs.
  const planned: PlannedPage[] = [];
  for (const [sectionIndex, page] of sections.entries()) {
    sink.path = ["Document", `Page[${sectionIndex}]`];
    const props = page.props as PageProps;
    const [width, height] = toPageSize(props.size, props.orientation);
    const margin = toSides(props.margin ?? 20 * MM);
    // On a page, `size` is the paper; the text size is `fontSize`.
    const { size: _paper, fontSize, ...textProps } = props;
    const context = inherit(base, {
      ...textProps,
      ...(fontSize !== undefined ? { size: fontSize } : {}),
    });
    sink.page = { width, height };
    const contentWidth = width - margin.left - margin.right;
    const contentHeight = height - margin.top - margin.bottom;
    if (!(contentWidth > 0 && contentHeight > 0)) {
      throw new LayoutError("The page margins leave no room for content");
    }
    // Headers and footers are measured once; their height must not depend on the page number.
    const sample = { page: 1, pages: 1 };
    const headerHeight =
      measureIn(furniture(props.header, sample), context, contentWidth, contentHeight)?.height ?? 0;
    const footerHeight =
      measureIn(furniture(props.footer, sample), context, contentWidth, contentHeight)?.height ?? 0;
    const bodyHeight = contentHeight - headerHeight - footerHeight;
    if (!(bodyHeight > 0)) throw new LayoutError("The header and footer leave no room for content");

    const body: LayoutNode = {
      type: "Stack",
      props: props.gap !== undefined ? { gap: props.gap } : {},
      children: page.children,
    };
    let state: unknown;
    let guard = 0;
    do {
      const result = layout(
        body,
        context,
        { width: contentWidth, height: bodyHeight, fresh: true },
        state,
        sink,
      );
      if (result.box) {
        result.box.x = margin.left;
        result.box.y = margin.top + headerHeight;
      } else if (result.state !== undefined) {
        throw new LayoutError("Content does not fit on an empty page and cannot be split");
      }
      planned.push({ page, context, width, height, body: result.box });
      state = result.state;
      if (++guard > 100_000)
        throw new LayoutError("The document did not finish after 100,000 pages");
    } while (state !== undefined);
  }

  // Second pass: now that the page count is known, add headers, footers and backgrounds.
  const buildPage = (plan: PlannedPage, index: number): DisplayPage => {
    const props = plan.page.props as PageProps;
    const margin = toSides(props.margin ?? 20 * MM);
    const info: PageInfo = { page: index + 1, pages: planned.length };
    sink.page = { width: plan.width, height: plan.height };
    const contentWidth = plan.width - margin.left - margin.right;
    const contentHeight = plan.height - margin.top - margin.bottom;
    const items: DisplayItem[] = [];
    const bleed = Math.max(0, props.bleed ?? 0);
    // The top-left corner of the bleed; plain zero, not negative zero, when there is none.
    const edge = bleed === 0 ? 0 : -bleed;
    if (props.fill !== undefined) {
      items.push({
        type: "path",
        commands: [["R", edge, edge, plan.width + bleed * 2, plan.height + bleed * 2]],
        fill: toColor(props.fill),
      });
    }
    const background = furniture(props.background, info);
    if (background) {
      // The background covers the bleed too, so full-bleed artwork needs no special care.
      const width = plan.width + bleed * 2;
      const height = plan.height + bleed * 2;
      sink.page = { width, height };
      const box = measureIn(
        { ...background, props: { width, height } },
        plan.context,
        width,
        height,
      );
      if (box) {
        const painted: DisplayItem[] = [];
        paintBox(box, 0, 0, painted);
        items.push(...shiftItems(painted, -bleed, -bleed));
      }
      sink.page = { width: plan.width, height: plan.height };
    }
    const header = measureIn(
      furniture(props.header, info),
      plan.context,
      contentWidth,
      contentHeight,
    );
    if (header) paintBox(header, margin.left, margin.top, items);
    if (plan.body) paintBox(plan.body, 0, 0, items);
    const placed: [Box, number, number][] = [];
    if (header) placed.push([header, margin.left, margin.top]);
    if (plan.body) placed.push([plan.body, 0, 0]);
    const footer = measureIn(
      furniture(props.footer, info),
      plan.context,
      contentWidth,
      contentHeight,
    );
    if (footer) paintBox(footer, margin.left, plan.height - margin.bottom - footer.height, items);
    if (footer) placed.push([footer, margin.left, plan.height - margin.bottom - footer.height]);
    if (options.debug) {
      // Outline every box, nested boxes in fainter lines.
      const outline = (box: Box, originX: number, originY: number, depth: number): void => {
        const x = box.page ? box.x : originX + box.x;
        const y = box.page ? box.y : originY + box.y;
        if (box.width > 0 && box.height > 0) {
          items.push({
            type: "path",
            commands: [["R", x, y, box.width, box.height]],
            stroke: {
              color: { space: "rgb", r: 1, g: 0, b: Math.min(1, depth * 0.25) },
              width: 0.25,
            },
          });
        }
        for (const child of box.children) outline(child, x, y, depth + 1);
      };
      for (const [box, x, y] of placed) outline(box, x, y, 0);
    }
    if (options.onBoxes) {
      options.onBoxes(
        index,
        placed.map(([box, x, y]) => describeBox(box, x, y)),
      );
    }
    const marks =
      props.marks === true
        ? { crop: true, registration: true }
        : props.marks
          ? { crop: props.marks.crop ?? false, registration: props.marks.registration ?? false }
          : undefined;
    return {
      width: plan.width,
      height: plan.height,
      items,
      ...(bleed > 0 ? { bleed } : {}),
      ...(marks && (marks.crop || marks.registration) ? { marks } : {}),
    };
  };

  // Images stretched too far print blurred; say so before the job goes to press.
  const minDpi = options.minImageDpi;
  const reported = new Set<object>();
  const checkResolution = (list: readonly DisplayItem[], pageNumber: number): void => {
    if (minDpi === undefined) return;
    const visit = (list: readonly DisplayItem[], pageNumber: number): void => {
      for (const item of list) {
        if (item.type === "group") visit(item.items, pageNumber);
        else if (item.type === "image" && !reported.has(item.image)) {
          const size = orientedSize(item.image);
          const dpi = Math.min((size.width * 72) / item.width, (size.height * 72) / item.height);
          if (dpi < minDpi - 0.5) {
            reported.add(item.image);
            lowResolution.push(
              `An image on page ${pageNumber} prints at ${Math.round(dpi)} dpi, below the ${minDpi} dpi asked for ` +
                `(${size.width} × ${size.height} pixels shown ${Math.round(item.width)} × ${Math.round(item.height)} points).`,
            );
          }
        }
      }
    };
    visit(list, pageNumber);
  };

  const headings: TocEntry[] = [];
  const collectHeadings = (list: readonly DisplayItem[], pageNumber: number): void => {
    for (const item of list) {
      if (item.type === "group") collectHeadings(item.items, pageNumber);
      else if (item.type === "heading") {
        headings.push({ title: item.title, level: item.level, id: item.id, page: pageNumber });
      }
    }
  };

  // Pages are painted one at a time and handed on at once when someone is waiting for them,
  // so a long document never holds more than one page of drawing instructions.
  const pages: DisplayPage[] = [];
  planned.forEach((plan, index) => {
    const page = buildPage(plan, index);
    plan.body = undefined;
    checkResolution(page.items, index + 1);
    collectHeadings(page.items, index + 1);
    if (consume) consume(page);
    else pages.push(page);
  });

  const warnings: LayoutWarning[] = [];
  if (sink.missingCharacters.size > 0) {
    const list = [...sink.missingCharacters.keys()].map((character) => `"${character}"`).join(", ");
    const [where] = sink.missingCharacters.values();
    warnings.push({
      code: "missing-glyph",
      message: `No font in use has a glyph for ${list}. Add a font that covers them to the font list.`,
      ...(where ? { path: where } : {}),
    });
  }
  for (const message of lowResolution) warnings.push({ code: "low-resolution-image", message });

  return { pages, warnings, usesToc: sink.usesToc, headings };
}

/** One box of a laid-out document, as `inspect()` reports it. */
export interface InspectedBox {
  /** The kind of element: `"Stack"`, `"Text"`, `"Table"`, … */
  readonly type: string;
  /** Position and size on the page in points, from its top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** For text: its lines. */
  readonly text?: readonly string[];
  readonly id?: string;
  readonly children?: readonly InspectedBox[];
}

function describeBox(box: Box, originX: number, originY: number): InspectedBox {
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  const x = box.page ? box.x : originX + box.x;
  const y = box.page ? box.y : originY + box.y;
  return {
    type: box.kind ?? "Box",
    x: round(x),
    y: round(y),
    width: round(box.width),
    height: round(box.height),
    ...(box.text ? { text: box.text.lines.map((line) => line.text) } : {}),
    ...(box.id !== undefined ? { id: box.id } : {}),
    ...(box.children.length > 0
      ? { children: box.children.map((child) => describeBox(child, x, y)) }
      : {}),
  };
}

/**
 * Lays out a document and returns the box of every element on every page, as plain data.
 * For tests ("the total is on the last page, right-aligned") and for bug reports: positions
 * are rounded to a thousandth of a point, so the result can be compared or stored as JSON.
 */
export function inspect(document: LayoutNode): { page: number; boxes: InspectedBox[] }[] {
  if (document?.type !== "Document") throw new LayoutError("inspect() needs a Document element");
  let pages: { page: number; boxes: InspectedBox[] }[] = [];
  let toc: TocEntry[] = [];
  for (let pass = 0; pass < 6; pass++) {
    pages = [];
    const result = layoutPass(
      document,
      { onBoxes: (index, boxes) => pages.push({ page: index + 1, boxes }) },
      toc,
      () => {},
    );
    const settled =
      !result.usesToc ||
      (toc.length === result.headings.length &&
        toc.every(
          (entry, i) =>
            entry.id === result.headings[i]?.id && entry.page === result.headings[i]?.page,
        ));
    if (settled) break;
    toc = result.headings;
  }
  return pages;
}

/** Moves display items by an offset. */
function shiftItems(items: readonly DisplayItem[], dx: number, dy: number): DisplayItem[] {
  if (dx === 0 && dy === 0) return [...items];
  return items.map((item): DisplayItem => {
    switch (item.type) {
      case "path":
        return {
          ...item,
          commands: item.commands.map((command) => {
            if (command[0] === "Z") return command;
            if (command[0] === "R")
              return ["R", command[1] + dx, command[2] + dy, command[3], command[4]];
            const moved: (string | number)[] = [command[0]];
            for (let i = 1; i < command.length; i += 2) {
              moved.push((command[i] as number) + dx, (command[i + 1] as number) + dy);
            }
            return moved as unknown as (typeof item.commands)[number];
          }),
        };
      case "group":
        return {
          ...item,
          ...(item.rotate
            ? { rotate: { ...item.rotate, cx: item.rotate.cx + dx, cy: item.rotate.cy + dy } }
            : {}),
          items: shiftItems(item.items, dx, dy),
        };
      case "image":
        return {
          ...item,
          x: item.x + dx,
          y: item.y + dy,
          ...(item.clip
            ? { clip: { ...item.clip, x: item.clip.x + dx, y: item.clip.y + dy } }
            : {}),
        };
      default:
        return { ...item, x: item.x + dx, y: item.y + dy };
    }
  });
}

/** Lays out a document and writes it as a PDF file. */
function renderSync(document: LayoutNode, options: RenderOptions = {}): Uint8Array {
  if (document?.type !== "Document") throw new LayoutError("render() needs a Document element");
  const props = document.props as DocumentProps;
  const info: Record<string, string> = {};
  for (const key of ["title", "author", "subject", "keywords", "creator"] as const) {
    const value = props[key];
    if (value !== undefined) info[key] = value;
  }
  const layoutOptions = {
    ...(options.minImageDpi !== undefined ? { minImageDpi: options.minImageDpi } : {}),
    ...(options.debug ? { debug: true } : {}),
  };
  // Each page is written as soon as it is painted. A table of contents needs its page numbers
  // from a finished layout, so such a document is written again until they agree.
  let toc: TocEntry[] = [];
  for (let pass = 0; ; pass++) {
    const pdf = new PdfDocument({
      info,
      deterministic: options.deterministic ?? false,
      compress: options.compress ?? true,
      ...(props.lang !== undefined ? { lang: props.lang } : {}),
      ...(options.conformance ? { conformance: options.conformance } : {}),
      ...(options.outputIntent ? { outputIntent: options.outputIntent } : {}),
    });
    const result = layoutPass(document, layoutOptions, toc, (page) =>
      writeDisplayPage(pdf, page, { boxes: options.conformance !== undefined }),
    );
    const settled =
      !result.usesToc ||
      pass >= 5 ||
      (toc.length === result.headings.length &&
        toc.every(
          (entry, i) =>
            entry.id === result.headings[i]?.id && entry.page === result.headings[i]?.page,
        ));
    if (settled) {
      for (const warning of result.warnings) {
        if (options.strict) {
          throw new LayoutError(
            warning.path ? `${warning.message} (at ${warning.path})` : warning.message,
          );
        }
        options.onWarning?.(warning);
      }
      return pdf.finish();
    }
    toc = result.headings;
  }
}

export interface Render {
  /** Lays out a document and returns the bytes of the PDF file. */
  (document: LayoutNode, options?: RenderOptions): Promise<Uint8Array>;
  /** The same, as a stream of bytes for writing to a file or a network response. */
  stream(document: LayoutNode, options?: RenderOptions): ReadableStream<Uint8Array>;
  /** The same, without a promise, for code that cannot wait. */
  sync(document: LayoutNode, options?: RenderOptions): Uint8Array;
}

export const render: Render = Object.assign(
  async (document: LayoutNode, options?: RenderOptions): Promise<Uint8Array> =>
    renderSync(document, options),
  {
    sync: renderSync,
    stream: (document: LayoutNode, options?: RenderOptions): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          try {
            const bytes = renderSync(document, options);
            // Hand the file over in pieces, so a slow consumer applies back-pressure.
            const chunk = 64 * 1024;
            for (let offset = 0; offset < bytes.length; offset += chunk) {
              controller.enqueue(bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      }),
  },
);
