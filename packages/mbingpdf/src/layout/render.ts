/** From a document tree to pages, and from pages to a PDF file. */
import { PdfDocument } from "../core/index.ts";
import type { DisplayItem, DisplayPage } from "./display.ts";
import { type Box, LayoutError, type LayoutSink, layout, normalize } from "./engine.ts";
import { paintBox } from "./paint.ts";
import { writeDisplayPage } from "./pdf.ts";
import { DEFAULT_TEXT, inherit, type TextContext, toColor, toPageSize, toSides } from "./style.ts";
import type { Child, LayoutNode, PageInfo, PageProps } from "./types.ts";

export interface LayoutWarning {
  /** What kind of problem this is. */
  readonly code: "missing-glyph";
  readonly message: string;
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
  if (source === undefined || source === null || source === false) return undefined;
  const content = typeof source === "function" ? source(info) : source;
  if (content === undefined || content === null || content === false) return undefined;
  return { type: "Stack", props: {}, children: [content] };
}

/** Lays out a document into pages of drawing instructions, without writing a file. */
export function layoutDocument(document: LayoutNode<"Document">): DocumentLayout {
  if (document?.type !== "Document") throw new LayoutError("render() needs a Document element");
  const sink: LayoutSink = { missingCharacters: new Set(), page: { width: 0, height: 0 } };
  const base = inherit(DEFAULT_TEXT, document.props);

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
  for (const page of sections) {
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
  const pages: DisplayPage[] = planned.map((plan, index) => {
    const props = plan.page.props as PageProps;
    const margin = toSides(props.margin ?? 20 * MM);
    const info: PageInfo = { page: index + 1, pages: planned.length };
    sink.page = { width: plan.width, height: plan.height };
    const contentWidth = plan.width - margin.left - margin.right;
    const contentHeight = plan.height - margin.top - margin.bottom;
    const items: DisplayItem[] = [];
    if (props.fill !== undefined) {
      items.push({
        type: "path",
        commands: [
          ["M", 0, 0],
          ["L", plan.width, 0],
          ["L", plan.width, plan.height],
          ["L", 0, plan.height],
          ["Z"],
        ],
        fill: toColor(props.fill),
      });
    }
    const background = furniture(props.background, info);
    if (background) {
      const box = measureIn(
        { ...background, props: { width: plan.width, height: plan.height } },
        plan.context,
        plan.width,
        plan.height,
      );
      if (box) paintBox(box, 0, 0, items);
    }
    const header = measureIn(
      furniture(props.header, info),
      plan.context,
      contentWidth,
      contentHeight,
    );
    if (header) paintBox(header, margin.left, margin.top, items);
    if (plan.body) paintBox(plan.body, 0, 0, items);
    const footer = measureIn(
      furniture(props.footer, info),
      plan.context,
      contentWidth,
      contentHeight,
    );
    if (footer) paintBox(footer, margin.left, plan.height - margin.bottom - footer.height, items);
    return { width: plan.width, height: plan.height, items };
  });

  const warnings: LayoutWarning[] = [];
  if (sink.missingCharacters.size > 0) {
    const list = [...sink.missingCharacters].map((character) => `"${character}"`).join(", ");
    warnings.push({
      code: "missing-glyph",
      message: `No font in use has a glyph for ${list}. Add a font that covers them to the font list.`,
    });
  }
  return { pages, warnings };
}

/** Lays out a document and writes it as a PDF file. */
function renderSync(document: LayoutNode<"Document">, options: RenderOptions = {}): Uint8Array {
  const result = layoutDocument(document);
  for (const warning of result.warnings) options.onWarning?.(warning);
  const props = document.props;
  const info: Record<string, string> = {};
  for (const key of ["title", "author", "subject", "keywords", "creator"] as const) {
    const value = props[key];
    if (value !== undefined) info[key] = value;
  }
  const pdf = new PdfDocument({
    info,
    deterministic: options.deterministic ?? false,
    compress: options.compress ?? true,
    ...(props.lang !== undefined ? { lang: props.lang } : {}),
  });
  for (const page of result.pages) writeDisplayPage(pdf, page);
  return pdf.finish();
}

export interface Render {
  /** Lays out a document and returns the bytes of the PDF file. */
  (document: LayoutNode<"Document">, options?: RenderOptions): Promise<Uint8Array>;
  /** The same, as a stream of bytes for writing to a file or a network response. */
  stream(document: LayoutNode<"Document">, options?: RenderOptions): ReadableStream<Uint8Array>;
  /** The same, without a promise, for code that cannot wait. */
  sync(document: LayoutNode<"Document">, options?: RenderOptions): Uint8Array;
}

export const render: Render = Object.assign(
  async (document: LayoutNode<"Document">, options?: RenderOptions): Promise<Uint8Array> =>
    renderSync(document, options),
  {
    sync: renderSync,
    stream: (
      document: LayoutNode<"Document">,
      options?: RenderOptions,
    ): ReadableStream<Uint8Array> =>
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
