// @vitest-environment happy-dom
import { Document, Link, Page, PageBreak, Text } from "mbingpdf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type App, createApp, defineComponent, h, nextTick, shallowRef } from "vue";
import { PdfPreview, type PdfResult, usePdf } from "../src/index.ts";

const sample = () =>
  Document(
    Page(
      { size: "A4" },
      Text("Hello"),
      Text(Link({ href: "https://example.com/a?b=1" }, "site")),
      Text(Link({ href: "javascript:alert(1)" }, "bad")),
      Text(Link({ to: "end" }, "jump")),
      PageBreak(),
      Text({ id: "end" }, "The end"),
    ),
  );

/** Stands in for the browser's observer; `reveal()` reports every watched element as visible. */
class FakeObserver {
  static all: FakeObserver[] = [];
  elements: Element[] = [];
  readonly callback: (entries: { isIntersecting: boolean }[]) => void;
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    this.callback = callback;
    FakeObserver.all.push(this);
  }
  observe(element: Element): void {
    this.elements.push(element);
  }
  disconnect(): void {
    this.elements = [];
  }
  static reveal(): void {
    for (const observer of FakeObserver.all) {
      if (observer.elements.length > 0) observer.callback([{ isIntersecting: true }]);
    }
  }
}

let host: HTMLElement;
let app: App | undefined;
const original = globalThis.IntersectionObserver;

function mount(render: () => ReturnType<typeof h>): void {
  app = createApp({ render });
  app.mount(host);
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  // Without an observer every page is drawn at once.
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  host.remove();
  globalThis.IntersectionObserver = original;
  FakeObserver.all = [];
});

describe("PdfPreview", () => {
  it("shows each page as a picture at the page's proportions", async () => {
    const document = sample();
    mount(() => h(PdfPreview, { document }));
    await nextTick();
    const pages = [...host.querySelectorAll<HTMLElement>("[data-page]")];
    expect(pages).toHaveLength(2);
    expect(pages[0]?.style.aspectRatio).toMatch(/^595\.2\d* \/ 841\.8\d*$/);
    await nextTick();
    for (const page of pages) {
      expect(page.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);
    }
    expect(pages[1]?.querySelector("img")?.getAttribute("alt")).toBe("Page 2");
  });

  it("puts working links on top, and leaves out unsafe ones", async () => {
    const node = sample();
    mount(() => h(PdfPreview, { document: node }));
    await nextTick();
    const links = [...host.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href")?.replace(/^#.*-/, "#"))).toEqual([
      "https://example.com/a?b=1",
      "#end",
    ]);
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");

    const id = links[1]?.getAttribute("href")?.slice(1) as string;
    const anchor = document.getElementById(id) as HTMLElement;
    expect(anchor.closest("[data-page]")?.getAttribute("data-page")).toBe("2");
    const scroll = vi.fn();
    anchor.scrollIntoView = scroll;
    links[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("draws a page only when it comes near the screen", async () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
    const document = sample();
    mount(() => h(PdfPreview, { document }));
    await nextTick();
    expect(host.querySelectorAll("[data-page]")).toHaveLength(2);
    expect(host.querySelectorAll("img")).toHaveLength(0);
    FakeObserver.reveal();
    await nextTick();
    expect(host.querySelectorAll("img")).toHaveLength(2);
  });

  it("lays out again when the document changes, and reports the page count", async () => {
    const document = shallowRef(sample());
    const onLayout = vi.fn();
    mount(() => h(PdfPreview, { document: document.value, onLayout }));
    await nextTick();
    expect(onLayout).toHaveBeenLastCalledWith({ pages: 2 });
    document.value = Document(Page({ size: "A5" }, Text("Only")));
    await nextTick();
    await nextTick();
    expect(onLayout).toHaveBeenLastCalledWith({ pages: 1 });
    expect(host.querySelectorAll("[data-page]")).toHaveLength(1);
  });

  it("shows a layout error in place, reports it, and offers a slot for it", async () => {
    const onError = vi.fn();
    mount(() => h(PdfPreview, { document: Text("not a document"), onError }));
    await nextTick();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Document");
    expect(onError).toHaveBeenCalledOnce();
    app?.unmount();

    mount(() =>
      h(
        PdfPreview,
        { document: Text("again") },
        { error: ({ error }: { error: unknown }) => [h("b", (error as Error).message)] },
      ),
    );
    await nextTick();
    expect(host.querySelector("b")?.textContent).toContain("Document");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("usePdf", () => {
  it("makes the file again when the document changes", async () => {
    const document = shallowRef<ReturnType<typeof sample> | undefined>(undefined);
    let result: PdfResult | undefined;
    const Probe = defineComponent(() => {
      result = usePdf(document, { deterministic: true });
      return () => null;
    });
    mount(() => h(Probe));
    await nextTick();
    expect(result?.loading.value).toBe(false);
    expect(result?.bytes.value).toBeUndefined();

    document.value = sample();
    await vi.waitFor(() => expect(result?.bytes.value).toBeDefined());
    expect(new TextDecoder().decode(result?.bytes.value?.subarray(0, 5))).toBe("%PDF-");
    expect(result?.url.value).toMatch(/^blob:/);
    expect(result?.loading.value).toBe(false);
  });

  it("reports a document that cannot be made", async () => {
    let result: PdfResult | undefined;
    const Probe = defineComponent(() => {
      result = usePdf(() => Text("not a document"));
      return () => null;
    });
    mount(() => h(Probe));
    await vi.waitFor(() => expect(result?.error.value).toBeInstanceOf(Error));
    expect(result?.bytes.value).toBeUndefined();
    expect(result?.loading.value).toBe(false);
  });
});
