/**
 * The logical structure of a tagged PDF: a tree of elements (paragraphs, headings, tables,
 * figures) that says what the marks on the pages mean and in what order to read them. Screen
 * readers and text reflow work from this tree, not from the page (ISO 32000-1, 14.7 and 14.8).
 */
import { PdfDict, PdfName, type PdfObject, type PdfRef, PdfString } from "./objects.ts";
import type { PdfWriter } from "./writer.ts";

/** The standard element types. */
export type StructureRole =
  | "Document"
  | "Part"
  | "Art"
  | "Sect"
  | "Div"
  | "BlockQuote"
  | "Caption"
  | "TOC"
  | "TOCI"
  | "Index"
  | "NonStruct"
  | "P"
  | "H1"
  | "H2"
  | "H3"
  | "H4"
  | "H5"
  | "H6"
  | "L"
  | "LI"
  | "Lbl"
  | "LBody"
  | "Table"
  | "TR"
  | "TH"
  | "TD"
  | "THead"
  | "TBody"
  | "TFoot"
  | "Span"
  | "Quote"
  | "Note"
  | "Reference"
  | "Code"
  | "Link"
  | "Figure"
  | "Formula";

export interface StructureOptions {
  /** A description that stands in for the element: required for figures. */
  alt?: string;
  /** The exact text the element's marks stand for, when they are not ordinary text. */
  actualText?: string;
  /** Language of the element's text, when it differs from the document's. */
  lang?: string;
  /** For a header cell: whether it heads its column, its row, or both. */
  scope?: "Column" | "Row" | "Both";
  /** For a table cell: how many columns and rows it covers, when more than one. */
  colSpan?: number;
  rowSpan?: number;
}

type Kid =
  | PdfStructElement
  | { readonly page: PdfRef; readonly mcid: number }
  | { readonly page: PdfRef; readonly object: PdfRef };

/** One element of the structure tree. Add children with {@link add}. */
export class PdfStructElement {
  readonly ref: PdfRef;
  readonly role: StructureRole;
  readonly #writer: PdfWriter;
  readonly #parent: PdfRef;
  readonly #options: StructureOptions;
  readonly #kids: Kid[] = [];
  /** The first page the element has content on. */
  #page: PdfRef | undefined;

  /** @internal Elements are made with `add()`, starting from `PdfDocument.structure`. */
  constructor(writer: PdfWriter, role: StructureRole, parent: PdfRef, options: StructureOptions) {
    this.#writer = writer;
    this.ref = writer.allocate();
    this.role = role;
    this.#parent = parent;
    this.#options = options;
  }

  /** Adds a child element after the ones already there. */
  add(role: StructureRole, options: StructureOptions = {}): PdfStructElement {
    const child = new PdfStructElement(this.#writer, role, this.ref, options);
    this.#kids.push(child);
    return child;
  }

  /** @internal Notes that marked content `mcid` of a page belongs to this element. */
  addContent(page: PdfRef, mcid: number): void {
    this.#page ??= page;
    this.#kids.push({ page, mcid });
  }

  /** @internal Notes that an annotation of a page belongs to this element. */
  addObject(page: PdfRef, object: PdfRef): void {
    this.#page ??= page;
    this.#kids.push({ page, object });
  }

  /** @internal Writes this element and everything under it. */
  write(): void {
    const options = this.#options;
    const kids = this.#kids.map((kid): PdfObject => {
      if (kid instanceof PdfStructElement) {
        kid.write();
        return kid.ref;
      }
      if ("object" in kid) {
        return new PdfDict({ Type: new PdfName("OBJR"), Obj: kid.object, Pg: kid.page });
      }
      // Content on the element's own page is named by its number alone.
      return kid.page === this.#page
        ? kid.mcid
        : new PdfDict({ Type: new PdfName("MCR"), Pg: kid.page, MCID: kid.mcid });
    });
    const table = new PdfDict({ O: new PdfName("Table") });
    if (options.scope) table.set("Scope", new PdfName(options.scope));
    if (options.colSpan !== undefined && options.colSpan > 1) table.set("ColSpan", options.colSpan);
    if (options.rowSpan !== undefined && options.rowSpan > 1) table.set("RowSpan", options.rowSpan);
    this.#writer.set(
      this.ref,
      new PdfDict({
        Type: new PdfName("StructElem"),
        S: new PdfName(this.role),
        P: this.#parent,
        Pg: this.#page,
        K: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids,
        Alt: options.alt === undefined ? undefined : PdfString.text(options.alt),
        ActualText:
          options.actualText === undefined ? undefined : PdfString.text(options.actualText),
        Lang: options.lang === undefined ? undefined : PdfString.text(options.lang),
        A: table.size > 1 ? table : undefined,
      }),
    );
  }
}

/** What marks content as page furniture rather than part of the document's text. */
export interface ArtifactOptions {
  /** `"Pagination"` for running heads and page numbers, `"Layout"` for rules and backgrounds. */
  type?: "Pagination" | "Layout" | "Page" | "Background";
  subtype?: "Header" | "Footer" | "Watermark";
}
