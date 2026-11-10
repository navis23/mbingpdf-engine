/**
 * `@mbingpdf/vue` — show an mbingpdf document on screen in a Vue or Nuxt app, and make the PDF.
 *
 * `PdfPreview` draws the pages; `usePdf` makes the file for downloading or sending.
 */
import { type LayoutNode, type RenderOptions, render } from "mbingpdf";
import { type PreviewPage, previewPages } from "mbingpdf/svg";
import {
  type DefineSetupFnComponent,
  defineComponent,
  h,
  type MaybeRefOrGetter,
  onBeforeUnmount,
  onMounted,
  type Ref,
  ref,
  type ShallowRef,
  type SlotsType,
  type StyleValue,
  shallowRef,
  toValue,
  useId,
  type VNode,
  watch,
} from "vue";

export interface PdfPreviewProps {
  /**
   * The document to show. It is laid out again whenever this value changes, so build it in a
   * `computed` rather than in the template.
   */
  document: LayoutNode;
  /** Space between pages, in CSS pixels. Default 16. */
  gap?: number;
  /** Outline every element's box, to see how a layout is put together. */
  debug?: boolean;
  /** Class and style of each page. The default style is a white sheet with a light shadow. */
  pageClass?: unknown;
  pageStyle?: StyleValue;
}

export type PdfPreviewEmits = {
  /** After each layout, with the number of pages. */
  layout: (info: { pages: number }) => void;
  /** When the document cannot be laid out. */
  error: (error: unknown) => void;
};

export type PdfPreviewSlots = SlotsType<{
  /** Shown in place of the pages when the document cannot be laid out. */
  error?: (props: { error: unknown }) => VNode[];
}>;

const percent = (part: number, whole: number): string => `${(part / whole) * 100}%`;

function follow(event: MouseEvent): void {
  const id = (event.currentTarget as HTMLAnchorElement).getAttribute("href")?.slice(1);
  const target = id ? globalThis.document.getElementById(id) : null;
  if (!target) return;
  // Scrolled by hand, so an app that keeps its route in the URL's hash is left alone.
  event.preventDefault();
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

interface PageViewProps {
  page: PreviewPage;
  index: number;
  prefix: string;
  pageClass?: unknown;
  pageStyle?: StyleValue;
}

/** One page: a picture of it, with its links laid on top. */
const PageView = defineComponent(
  (props: PageViewProps) => {
    const element = ref<HTMLElement>();
    const src = ref<string>();
    let observer: IntersectionObserver | undefined;

    const show = (): void => {
      src.value = URL.createObjectURL(new Blob([props.page.svg()], { type: "image/svg+xml" }));
    };

    // The picture is made when the page comes near the screen, so a document of thousands of
    // pages opens at once.
    onMounted(() => {
      if (typeof IntersectionObserver === "undefined" || !element.value) return show();
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            show();
          }
        },
        { rootMargin: "100% 0px" },
      );
      observer.observe(element.value);
    });

    onBeforeUnmount(() => {
      observer?.disconnect();
      if (src.value) URL.revokeObjectURL(src.value);
    });

    return () => {
      const { page, index, prefix } = props;
      return h(
        "div",
        {
          ref: element,
          class: props.pageClass,
          "data-page": index + 1,
          style: [
            {
              position: "relative",
              width: "100%",
              aspectRatio: `${page.width} / ${page.height}`,
              background: "white",
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.25)",
            },
            props.pageStyle,
          ],
        },
        [
          src.value &&
            h("img", {
              src: src.value,
              alt: `Page ${index + 1}`,
              draggable: false,
              style: {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                display: "block",
              },
            }),
          ...page.anchors.map((anchor) =>
            h("span", {
              id: prefix + anchor.id,
              style: {
                position: "absolute",
                left: percent(anchor.x, page.width),
                top: percent(anchor.y, page.height),
              },
            }),
          ),
          ...page.links.map((link) =>
            h("a", {
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
        ],
      );
    };
  },
  { name: "PdfPreviewPage", props: ["page", "index", "prefix", "pageClass", "pageStyle"] },
);

/**
 * Shows a document page by page, exactly as the PDF will look: the same line breaks, the same
 * page breaks. Pages take the width of the element around them. Links work.
 */
export const PdfPreview: DefineSetupFnComponent<PdfPreviewProps, PdfPreviewEmits, PdfPreviewSlots> =
  defineComponent<PdfPreviewProps, PdfPreviewEmits, string, PdfPreviewSlots>(
    (props: PdfPreviewProps, { emit, slots }) => {
      const prefix = `${useId()}-`;
      const pages = shallowRef<PreviewPage[]>([]);
      const failure = shallowRef<{ error: unknown }>();
      let version = 0;

      // Laid out in the browser only: a server has no screen to preview on.
      onMounted(() => {
        watch(
          () => [props.document, props.debug] as const,
          ([document, debug]) => {
            version++;
            try {
              pages.value = previewPages(document, { debug: debug ?? false });
              failure.value = undefined;
              emit("layout", { pages: pages.value.length });
            } catch (error) {
              pages.value = [];
              failure.value = { error };
              emit("error", error);
            }
          },
          { immediate: true },
        );
      });

      return () =>
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: `${props.gap ?? 16}px` } },
          failure.value
            ? (slots.error?.(failure.value) ?? [
                h(
                  "pre",
                  { role: "alert", style: { whiteSpace: "pre-wrap", color: "#b00020" } },
                  failure.value.error instanceof Error
                    ? failure.value.error.message
                    : String(failure.value.error),
                ),
              ])
            : pages.value.map((page, index) =>
                h(PageView, {
                  // A new layout gives new pages, so each view belongs to one page for life.
                  key: `${version}-${index}`,
                  page,
                  index,
                  prefix,
                  pageClass: props.pageClass,
                  pageStyle: props.pageStyle,
                }),
              ),
        );
    },
    {
      name: "PdfPreview",
      props: ["document", "gap", "debug", "pageClass", "pageStyle"],
      emits: ["layout", "error"],
    },
  );

export interface PdfResult {
  /** The file's bytes, once made. */
  bytes: ShallowRef<Uint8Array | undefined>;
  /** An address for the file, usable as a link's `href` or an `<iframe>`'s `src`. */
  url: Ref<string | undefined>;
  /** What went wrong, if the document could not be made. */
  error: ShallowRef<unknown>;
  /** True while the file is being made. */
  loading: Ref<boolean>;
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
 * Makes the PDF file of a document, again whenever the document changes. Pass a ref, a
 * `computed` or a function; while it gives `undefined`, nothing is made. Runs in the browser
 * only.
 */
export function usePdf(
  document: MaybeRefOrGetter<LayoutNode | undefined>,
  options?: MaybeRefOrGetter<RenderOptions | undefined>,
): PdfResult {
  const bytes = shallowRef<Uint8Array>();
  const url = ref<string>();
  const error = shallowRef<unknown>();
  const loading = ref(false);
  let run = 0;

  const release = (): void => {
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = undefined;
  };

  onMounted(() => {
    watch(
      () => toValue(document),
      (node) => {
        const mine = ++run;
        if (!node) {
          release();
          bytes.value = undefined;
          error.value = undefined;
          loading.value = false;
          return;
        }
        loading.value = true;
        render(node, toValue(options)).then(
          (result) => {
            if (mine !== run) return;
            release();
            bytes.value = result;
            url.value = URL.createObjectURL(
              new Blob([result as BlobPart], { type: "application/pdf" }),
            );
            error.value = undefined;
            loading.value = false;
          },
          (reason: unknown) => {
            if (mine !== run) return;
            release();
            bytes.value = undefined;
            error.value = reason;
            loading.value = false;
          },
        );
      },
      { immediate: true },
    );
  });

  onBeforeUnmount(() => {
    run++;
    release();
  });

  return {
    bytes,
    url,
    error,
    loading,
    download: (filename: string): void => {
      if (bytes.value) downloadPdf(bytes.value, filename);
    },
  };
}
