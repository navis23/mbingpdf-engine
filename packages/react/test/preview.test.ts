// @vitest-environment happy-dom
import { Document, type LayoutNode, Link, Page, PageBreak, Text } from "mbingpdf";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfPreview, type PdfResult, type UsePdfOptions, usePdf } from "../src/index.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

let renders = 0;
/** Builds its document anew on every render, as a careless caller would. */
function Unstable(): null {
  renders++;
  result = usePdf(sample(), { lazy: true });
  return null;
}

let host: HTMLElement;
let root: Root;
const original = globalThis.IntersectionObserver;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // Without an observer every page is drawn at once.
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  globalThis.IntersectionObserver = original;
  FakeObserver.all = [];
});

describe("PdfPreview", () => {
  it("shows the fallback until the first layout, and never after", async () => {
    const { renderToString } = await import("react-dom/server");
    const document = sample();
    const fallback = createElement("p", { className: "wait" }, "Menyiapkan…");
    expect(renderToString(createElement(PdfPreview, { document, fallback }))).toContain(
      "Menyiapkan…",
    );
    await act(async () => root.render(createElement(PdfPreview, { document, fallback })));
    expect(host.querySelector(".wait")).toBeNull();
    expect(host.querySelectorAll("[data-page]").length).toBe(2);
  });

  it("shows each page as a picture at the page's proportions", () => {
    act(() => root.render(createElement(PdfPreview, { document: sample() })));
    const pages = [...host.querySelectorAll<HTMLElement>("[data-page]")];
    expect(pages).toHaveLength(2);
    expect(pages[0]?.style.aspectRatio).toMatch(/^595\.2\d* \/ 841\.8\d*$/);
    for (const page of pages) {
      const image = page.querySelector("img");
      expect(image?.getAttribute("src")).toMatch(/^blob:/);
    }
    expect(pages[1]?.querySelector("img")?.getAttribute("alt")).toBe("Page 2 of 2");
  });

  it("gives screen readers a label of your wording and the page's text", () => {
    const pageLabel = (page: number, pages: number): string => `Halaman ${page} dari ${pages}`;
    act(() => root.render(createElement(PdfPreview, { document: sample(), pageLabel })));
    const pages = [...host.querySelectorAll<HTMLElement>("[data-page]")];
    expect(pages[0]?.querySelector("img")?.getAttribute("alt")).toBe("Halaman 1 dari 2");
    // The picture holds no text; the words are beside it, out of sight.
    const words = pages[0]?.querySelector("div");
    expect(words?.textContent?.length).toBeGreaterThan(5);
    expect(words?.style.overflow).toBe("hidden");
  });

  it("puts working links on top, and leaves out unsafe ones", () => {
    act(() => root.render(createElement(PdfPreview, { document: sample() })));
    const links = [...host.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href")?.replace(/^#.*-/, "#"))).toEqual([
      "https://example.com/a?b=1",
      "#end",
    ]);
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0]?.style.width).toMatch(/%$/);

    // The link within the document scrolls to its anchor, which is on page 2.
    const id = links[1]?.getAttribute("href")?.slice(1) as string;
    const anchor = document.getElementById(id) as HTMLElement;
    expect(anchor.closest("[data-page]")?.getAttribute("data-page")).toBe("2");
    const scroll = vi.fn();
    anchor.scrollIntoView = scroll;
    act(() =>
      links[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    );
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("draws a page only when it comes near the screen", () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
    act(() => root.render(createElement(PdfPreview, { document: sample() })));
    expect(host.querySelectorAll("[data-page]")).toHaveLength(2);
    expect(host.querySelectorAll("img")).toHaveLength(0);
    act(() => FakeObserver.reveal());
    expect(host.querySelectorAll("img")).toHaveLength(2);
  });

  it("lays out again when the document changes, and reports the page count", () => {
    const onLayout = vi.fn();
    act(() => root.render(createElement(PdfPreview, { document: sample(), onLayout })));
    expect(onLayout).toHaveBeenLastCalledWith({ pages: 2 });
    const one = Document(Page({ size: "A5" }, Text("Only")));
    act(() => root.render(createElement(PdfPreview, { document: one, onLayout })));
    expect(onLayout).toHaveBeenLastCalledWith({ pages: 1 });
    expect(host.querySelectorAll("[data-page]")).toHaveLength(1);
  });

  it("shows a layout error in place, or hands it to onError", () => {
    const broken = Text("not a document");
    act(() => root.render(createElement(PdfPreview, { document: broken })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Document");

    const onError = vi.fn();
    act(() => root.render(createElement(PdfPreview, { document: Text("again"), onError })));
    expect(onError).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

let result: PdfResult | undefined;

/** Calls the hook and keeps what it returned for the test to look at. */
function Probe({ document, options }: { document: LayoutNode; options?: UsePdfOptions }): null {
  result = usePdf(document, options);
  return null;
}

describe("usePdf", () => {
  it("makes the file and gives an address for it", async () => {
    const document = sample();
    const options = { deterministic: true };
    await act(async () => root.render(createElement(Probe, { document, options })));
    await vi.waitFor(() => expect(result?.loading).toBe(false));
    expect(new TextDecoder().decode(result?.bytes?.subarray(0, 5))).toBe("%PDF-");
    expect(result?.url).toMatch(/^blob:/);
    expect(result?.error).toBeUndefined();
  });

  it("in lazy mode makes nothing until asked", async () => {
    const document = sample();
    const options = { deterministic: true, lazy: true };
    await act(async () => root.render(createElement(Probe, { document, options })));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result?.loading).toBe(false);
    expect(result?.bytes).toBeUndefined();
    let made: Uint8Array | undefined;
    await act(async () => {
      made = await result?.make();
    });
    expect(new TextDecoder().decode(made?.subarray(0, 5))).toBe("%PDF-");
    expect(result?.bytes).toBe(made);
    expect(result?.url).toMatch(/^blob:/);
    // A new document makes the old file stale.
    await act(async () => root.render(createElement(Probe, { document: sample(), options })));
    await vi.waitFor(() => expect(result?.bytes).toBeUndefined());
  });

  it("in lazy mode a document that is new on every render does not loop", async () => {
    renders = 0;
    await act(async () => root.render(createElement(Unstable)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(renders).toBeLessThan(5);
    expect(result?.loading).toBe(false);
  });

  it("reports a document that cannot be made", async () => {
    const document = Text("not a document");
    await act(async () => root.render(createElement(Probe, { document })));
    await vi.waitFor(() => expect(result?.error).toBeInstanceOf(Error));
    expect(result?.bytes).toBeUndefined();
    expect(result?.loading).toBe(false);
  });
});
