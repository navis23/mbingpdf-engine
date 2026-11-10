/**
 * `@mbingpdf/react` — show an mbingpdf document on screen in a React app, and make the PDF.
 *
 * `PdfPreview` draws the pages; `usePdf` makes the file for downloading or sending.
 */
import { type LayoutNode, type RenderOptions, render } from "mbingpdf";
import { type PreviewPage, previewPages } from "mbingpdf/svg";
import {
  type CSSProperties,
  createElement,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export interface PdfPreviewProps {
  /**
   * The document to show. It is laid out again whenever this value changes, so keep it stable
   * between renders (`useMemo`) unless its content really changed.
   */
  document: LayoutNode;
  /** Space between pages, in CSS pixels. Default 16. */
  gap?: number;
  /** Outline every element's box, to see how a layout is put together. */
  debug?: boolean;
  /** Class and style of the element around all pages. */
  className?: string;
  style?: CSSProperties;
  /** Class and style of each page. The default style is a white sheet with a light shadow. */
  pageClassName?: string;
  pageStyle?: CSSProperties;
  /** Called after each layout with the number of pages. */
  onLayout?: (info: { pages: number }) => void;
  /** Called when the document cannot be laid out. Without it the error is shown in place. */
  onError?: (error: unknown) => void;
}

const percent = (part: number, whole: number): string => `${(part / whole) * 100}%`;

interface PageViewProps {
  page: PreviewPage;
  index: number;
  prefix: string;
  className: string | undefined;
  style: CSSProperties | undefined;
}

/** One page: a picture of it, with its links laid on top. */
function PageView({ page, index, prefix, className, style }: PageViewProps): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string>();

  // The picture is made when the page comes near the screen, so a document of thousands of
  // pages opens at once.
  useEffect(() => {
    let url: string | undefined;
    const show = (): void => {
      url = URL.createObjectURL(new Blob([page.svg()], { type: "image/svg+xml" }));
      setSrc(url);
    };
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined" || !element.current) show();
    else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            show();
          }
        },
        { rootMargin: "100% 0px" },
      );
      observer.observe(element.current);
    }
    return () => {
      observer?.disconnect();
      if (url) URL.revokeObjectURL(url);
      setSrc(undefined);
    };
  }, [page]);

  const follow = useCallback((event: MouseEvent<HTMLAnchorElement>): void => {
    const id = event.currentTarget.getAttribute("href")?.slice(1);
    const target = id ? globalThis.document.getElementById(id) : null;
    if (!target) return;
    // Scrolled by hand, so an app that keeps its route in the URL's hash is left alone.
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return createElement(
    "div",
    {
      ref: element,
      className,
      "data-page": index + 1,
      style: {
        position: "relative",
        width: "100%",
        aspectRatio: `${page.width} / ${page.height}`,
        background: "white",
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.25)",
        ...style,
      },
    },
    src &&
      createElement("img", {
        src,
        alt: `Page ${index + 1}`,
        draggable: false,
        style: { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" },
      }),
    ...page.anchors.map((anchor, i) =>
      createElement("span", {
        key: `a${i}`,
        id: prefix + anchor.id,
        style: {
          position: "absolute",
          left: percent(anchor.x, page.width),
          top: percent(anchor.y, page.height),
        },
      }),
    ),
    ...page.links.map((link, i) =>
      createElement("a", {
        key: `l${i}`,
        ...(link.url !== undefined
          ? { href: link.url, target: "_blank", rel: "noopener noreferrer" }
          : { href: `#${prefix}${link.target}`, onClick: follow }),
        style: {
          position: "absolute",
          left: percent(link.x, page.width),
          top: percent(link.y, page.height),
          width: percent(link.width, page.width),
          height: percent(link.height, page.height),
        },
      }),
    ),
  );
}

/**
 * Shows a document page by page, exactly as the PDF will look: the same line breaks, the same
 * page breaks. Pages take the width of the element around them. Links work.
 */
export function PdfPreview(props: PdfPreviewProps): ReactElement {
  const { document, debug = false, gap = 16 } = props;
  const prefix = `${useId()}-`;
  const [state, setState] = useState<{ pages: PreviewPage[]; error?: unknown }>({ pages: [] });
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    try {
      const pages = previewPages(document, { debug });
      setState({ pages });
      callbacks.current.onLayout?.({ pages: pages.length });
    } catch (error) {
      setState({ pages: [], error });
      callbacks.current.onError?.(error);
    }
  }, [document, debug]);

  return createElement(
    "div",
    {
      className: props.className,
      style: { display: "flex", flexDirection: "column", gap, ...props.style },
    },
    state.error !== undefined && !props.onError
      ? createElement(
          "pre",
          { role: "alert", style: { whiteSpace: "pre-wrap", color: "#b00020" } },
          state.error instanceof Error ? state.error.message : String(state.error),
        )
      : state.pages.map((page, index) =>
          createElement(PageView, {
            key: index,
            page,
            index,
            prefix,
            className: props.pageClassName,
            style: props.pageStyle,
          }),
        ),
  );
}

export interface PdfResult {
  /** The file's bytes, once made. */
  bytes: Uint8Array | undefined;
  /** An address for the file, usable as a link's `href` or an `<iframe>`'s `src`. */
  url: string | undefined;
  /** What went wrong, if the document could not be made. */
  error: unknown;
  /** True while the file is being made. */
  loading: boolean;
  /** Saves the file under this name. Does nothing until the file is made. */
  download: (filename: string) => void;
}

/** Saves bytes as a file from the browser. */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = globalThis.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // The download has started by the next task; the address is no longer needed after that.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Makes the PDF file of a document, again whenever the document changes. Keep the document
 * stable between renders (`useMemo`). Pass `undefined` to make nothing yet.
 */
export function usePdf(document: LayoutNode | undefined, options?: RenderOptions): PdfResult {
  const [state, setState] = useState<{ bytes?: Uint8Array; url?: string; error?: unknown }>({});
  const [loading, setLoading] = useState(document !== undefined);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (!document) {
      setState({});
      setLoading(false);
      return;
    }
    let current = true;
    let url: string | undefined;
    setLoading(true);
    render(document, latest.current).then(
      (bytes) => {
        if (!current) return;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        setState({ bytes, url });
        setLoading(false);
      },
      (error: unknown) => {
        if (!current) return;
        setState({ error });
        setLoading(false);
      },
    );
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [document]);

  const { bytes } = state;
  const download = useCallback(
    (filename: string): void => {
      if (bytes) downloadPdf(bytes, filename);
    },
    [bytes],
  );
  return { bytes, url: state.url, error: state.error, loading, download };
}
