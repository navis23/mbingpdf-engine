import type { AnyFont, FontBinding } from "./content.ts";
import { EmbeddedFont } from "./embedded-font.ts";
import { writeGlyphRun } from "./glyph-run.ts";
import { PdfDict, PdfName, type PdfObject, type PdfRef, PdfString } from "./objects.ts";
import { PdfPage, type PdfPageOptions } from "./page.ts";
import { writeObject } from "./serialize.ts";
import { StandardFont } from "./standard-font.ts";
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
  readonly #fonts: Map<AnyFont, FontBinding & { ref: PdfRef }> = new Map();
  readonly #embedded: { font: EmbeddedFont; ref: PdfRef }[] = [];

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
        fontResource: (font) => this.#fontResource(font),
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
    for (const { font, ref } of this.#embedded) font.write(writer, ref);
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

  /** One font object per font, shared by every page that uses it. */
  #fontResource(font: AnyFont): FontBinding & { ref: PdfRef } {
    let resource = this.#fonts.get(font);
    if (resource) return resource;
    const name = `F${this.#fonts.size + 1}`;
    if (font instanceof StandardFont) {
      const ref = this.writer.add(
        new PdfDict({
          Type: new PdfName("Font"),
          Subtype: new PdfName("Type1"),
          BaseFont: new PdfName(font.name),
          // Symbol and ZapfDingbats keep their built-in encoding.
          Encoding: font.symbolic ? undefined : new PdfName("WinAnsiEncoding"),
        }),
      );
      resource = {
        name,
        ref,
        show: (out, text) => {
          writeObject(out, new PdfString(font.encode(text)));
          out.ascii(" Tj\n");
        },
        showGlyphs: (out, glyphs, text, size, rise) =>
          writeGlyphRun(
            out,
            {
              unitsPerEm: 1000,
              bytesPerGlyph: 1,
              // Code 0 stands for a character the font lacks: leave its space empty.
              code: (glyph) => (glyph === 0 ? undefined : glyph),
              width: (glyph) => font.advanceOfCode(glyph),
            },
            glyphs,
            text,
            size,
            rise,
          ),
      };
    } else {
      // The subset is only known once every page is drawn, so the object is written in finish().
      const embedded = new EmbeddedFont(font);
      const ref = this.writer.allocate();
      this.#embedded.push({ font: embedded, ref });
      resource = {
        name,
        ref,
        show: (out, text, size, rise) => embedded.show(out, text, size, rise),
        showGlyphs: (out, glyphs, text, size, rise) =>
          embedded.showGlyphs(out, glyphs, text, size, rise),
      };
    }
    this.#fonts.set(font, resource);
    return resource;
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
