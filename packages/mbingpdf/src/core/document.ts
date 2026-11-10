import { PdfDict, PdfName, type PdfObject, type PdfRef, PdfString } from "./objects.ts";
import { PdfPage, type PdfPageOptions } from "./page.ts";
import { PdfWriter, type PdfWriterOptions } from "./writer.ts";

/** Document information shown in a viewer's properties dialog. */
export interface PdfInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  /** The application that made the original content. */
  creator?: string;
  /** The software that produced the PDF. Default `"mbingpdf"`. */
  producer?: string;
  creationDate?: Date;
  modDate?: Date;
}

export interface PdfDocumentOptions extends PdfWriterOptions {
  info?: PdfInfo;
  /**
   * When true the library never reads the clock: dates appear only if given in `info`, so the
   * same input always yields the same bytes. Default `false`, which stamps the current time.
   */
  deterministic?: boolean;
}

/**
 * The document skeleton: catalog, page tree and information dictionary on top of a
 * {@link PdfWriter}. Pages are written as they are added.
 */
export class PdfDocument {
  readonly writer: PdfWriter;
  readonly #info: PdfInfo;
  readonly #deterministic: boolean;
  readonly #pagesRef: PdfRef;
  readonly #pages: PdfPage[] = [];
  readonly #opacityStates: Map<string, { name: string; ref: PdfRef }> = new Map();

  constructor(options: PdfDocumentOptions = {}) {
    this.writer = new PdfWriter(options);
    this.#info = options.info ?? {};
    this.#deterministic = options.deterministic ?? false;
    this.#pagesRef = this.writer.allocate();
  }

  get pageCount(): number {
    return this.#pages.length;
  }

  /** Starts a new page. Draw on it through `page.content`. */
  addPage(options: PdfPageOptions): PdfPage {
    const page = new PdfPage(
      {
        writer: this.writer,
        pagesRef: this.#pagesRef,
        opacityState: (fill, stroke) => this.#opacityState(fill, stroke),
      },
      options,
    );
    this.#pages.push(page);
    return page;
  }

  /** Completes the file and returns its bytes. The document cannot be used afterwards. */
  finish(): Uint8Array {
    const writer = this.writer;
    if (this.#pages.length === 0) throw new Error("A PDF needs at least one page");
    for (const page of this.#pages) page.end();
    writer.set(
      this.#pagesRef,
      new PdfDict({
        Type: new PdfName("Pages"),
        Kids: this.#pages.map((page) => page.ref),
        Count: this.#pages.length,
      }),
    );
    const root = writer.add(new PdfDict({ Type: new PdfName("Catalog"), Pages: this.#pagesRef }));
    const info = writer.add(this.#infoDict());
    return writer.finish({ root, info });
  }

  /** One ExtGState object per distinct opacity pair, shared by every page that uses it. */
  #opacityState(
    fill: number | undefined,
    stroke: number | undefined,
  ): { name: string; ref: PdfRef } {
    const key = `${fill ?? ""}/${stroke ?? ""}`;
    let state = this.#opacityStates.get(key);
    if (!state) {
      const ref = this.writer.add(
        new PdfDict({ Type: new PdfName("ExtGState"), ca: fill, CA: stroke }),
      );
      state = { name: `GS${this.#opacityStates.size + 1}`, ref };
      this.#opacityStates.set(key, state);
    }
    return state;
  }

  #infoDict(): PdfDict {
    const info = this.#info;
    const text = (value: string | undefined): PdfObject | undefined =>
      value === undefined ? undefined : PdfString.text(value);
    const created = info.creationDate ?? (this.#deterministic ? undefined : new Date());
    const modified = info.modDate ?? created;
    return new PdfDict({
      Title: text(info.title),
      Author: text(info.author),
      Subject: text(info.subject),
      Keywords: text(info.keywords),
      Creator: text(info.creator),
      Producer: PdfString.text(info.producer ?? "mbingpdf"),
      CreationDate: created && PdfString.date(created),
      ModDate: modified && PdfString.date(modified),
    });
  }
}
