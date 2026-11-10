import type { Color } from "./color.ts";
import type { AnyFont, FontBinding } from "./content.ts";
import { EmbeddedFont } from "./embedded-font.ts";
import { writeGlyphRun } from "./glyph-run.ts";
import { type PdfImage, writeImage } from "./image.ts";
import { PdfDict, PdfName, type PdfObject, type PdfRef, PdfStream, PdfString } from "./objects.ts";
import { type PageHost, PdfForm, PdfPage, type PdfPageOptions } from "./page.ts";
import { writeObject } from "./serialize.ts";
import { srgbProfile } from "./srgb.ts";
import { StandardFont } from "./standard-font.ts";
import { PdfStructElement } from "./structure.ts";
import type { Box } from "./units.ts";
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

/** The printing condition a document is prepared for. */
export interface OutputIntent {
  /** The ICC profile of the press and paper, as the print shop names it: the file's bytes. */
  profile: Uint8Array;
  /** The registered name of the condition, such as `"FOGRA39"` or `"CGATS TR 001"`. */
  identifier: string;
  /** A human-readable description; default: the identifier. */
  info?: string;
  /** Where the condition is registered. Default `"http://www.color.org"`. */
  registry?: string;
}

/**
 * A standard a file can be made to meet.
 *
 * - `"PDF/X-4"`: commercial printing. Needs an output intent, a trim box on every page and
 *   every font embedded.
 * - `"PDF/A-2b"`, `"PDF/A-2u"`: long-term archiving. Every font embedded and every colour tied
 *   to a profile; `u` adds that all text can be read back as Unicode, which this library's
 *   output always can.
 * - `"PDF/A-3b"`, `"PDF/A-3u"`: the same, and other files may be attached (an e-invoice's XML).
 * - `"PDF/A-2a"`, `"PDF/A-3a"`: the `u` level plus a tagged structure.
 * - `"PDF/UA-1"`: accessibility. A tagged structure, a title and a language, every font
 *   embedded, and a description for every figure and link.
 */
export type Conformance =
  | "PDF/X-4"
  | "PDF/A-2b"
  | "PDF/A-2u"
  | "PDF/A-2a"
  | "PDF/A-3b"
  | "PDF/A-3u"
  | "PDF/A-3a"
  | "PDF/UA-1";

export interface PdfDocumentOptions extends PdfWriterOptions {
  info?: PdfInfo;
  /**
   * The standard the file must meet, or several: `["PDF/X-4", "PDF/A-2b"]`. The file is
   * checked against them as it is written, and what cannot be met is an error.
   */
  conformance?: Conformance | readonly Conformance[];
  /**
   * The printing condition the document is prepared for. Required for PDF/X-4. For PDF/A it
   * is optional: without one the file is declared to be in sRGB.
   */
  outputIntent?: OutputIntent;
  /** Language of the document's text, as a BCP 47 tag such as `"id"` or `"en-GB"`. */
  lang?: string;
  /**
   * Make a tagged PDF: one that carries its logical structure, built through
   * {@link PdfDocument.structure}. Implied by PDF/UA-1 and the `a` levels of PDF/A.
   */
  tagged?: boolean;
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
  readonly #lang: string | undefined;
  /** True when the file must be PDF/X-4. */
  readonly #print: boolean;
  /** The PDF/A flavour the file must be, if any. */
  readonly #archive: { part: 2 | 3; level: "B" | "U" | "A" } | undefined;
  /** True when the file must be PDF/UA-1. */
  readonly #accessible: boolean;
  readonly #structure: PdfStructElement | undefined;
  readonly #structRoot: PdfRef | undefined;
  /** The parent tree: for each key, the elements of a page's content or of an annotation. */
  readonly #parents: PdfObject[] = [];
  readonly #outputIntent: OutputIntent | undefined;
  #intentProfile: PdfRef | undefined;
  #srgb: { name: string; ref: PdfRef } | undefined;
  readonly #spots: Map<string, { name: string; ref: PdfRef }> = new Map();
  readonly #destinations: Map<string, PdfObject> = new Map();
  readonly #bookmarks: { title: string; level: number; dest: PdfObject }[] = [];
  #usesStandardFonts = false;
  #now: Date | undefined;
  readonly #pagesRef: PdfRef;
  readonly #pages: PdfPage[] = [];
  readonly #forms: PdfForm[] = [];
  readonly #opacityStates: Map<string, { name: string; ref: PdfRef }> = new Map();
  readonly #fonts: Map<AnyFont, FontBinding & { ref: PdfRef }> = new Map();
  readonly #embedded: { font: EmbeddedFont; ref: PdfRef }[] = [];
  readonly #images: Map<PdfImage, { name: string; ref: PdfRef }> = new Map();

  constructor(options: PdfDocumentOptions = {}) {
    this.writer = new PdfWriter(options);
    this.#info = options.info ?? {};
    this.#deterministic = options.deterministic ?? false;
    this.#lang = options.lang;
    const standards =
      options.conformance === undefined
        ? []
        : typeof options.conformance === "string"
          ? [options.conformance]
          : [...options.conformance];
    this.#print = standards.includes("PDF/X-4");
    const archives = standards.filter((standard) => standard.startsWith("PDF/A"));
    if (archives.length > 1) {
      throw new Error(`A file can meet one PDF/A level, not ${archives.join(" and ")}`);
    }
    const archive = archives[0];
    this.#archive = archive
      ? {
          part: archive.includes("-3") ? 3 : 2,
          level: archive.endsWith("u") ? "U" : archive.endsWith("a") ? "A" : "B",
        }
      : undefined;
    this.#accessible = standards.includes("PDF/UA-1");
    if (this.#accessible) {
      if (!options.info?.title) throw new Error("PDF/UA needs the document to have a title");
      if (!options.lang) {
        throw new Error('PDF/UA needs the language of the document, such as lang: "id"');
      }
    }
    if (this.#print && !options.outputIntent) {
      throw new Error("PDF/X-4 needs an output intent: the ICC profile of the printing condition");
    }
    // An archived file must say what its colours mean; without a printing condition, sRGB.
    this.#outputIntent =
      options.outputIntent ??
      (archive ? { profile: srgbProfile(), identifier: "sRGB IEC61966-2.1" } : undefined);
    if (options.outputIntent) {
      const profile = options.outputIntent.profile;
      const signature = String.fromCharCode(...profile.subarray(36, 40));
      if (profile.length < 132 || signature !== "acsp")
        throw new Error("The output intent profile is not an ICC profile");
    }
    if (archive && options.outputIntent) {
      const profile = options.outputIntent.profile;
      const deviceClass = String.fromCharCode(...profile.subarray(12, 16));
      if (deviceClass !== "prtr" && deviceClass !== "mntr") {
        throw new Error(
          "PDF/A needs the output intent to be a printer or display profile; " +
            `this one is of class "${deviceClass.trim()}"`,
        );
      }
    }
    this.#pagesRef = this.writer.allocate();
    if (options.tagged || this.#accessible || this.#archive?.level === "A") {
      this.#structRoot = this.writer.allocate();
      this.#structure = new PdfStructElement(this.writer, "Document", this.#structRoot, {});
    }
  }

  /**
   * The root of the document's logical structure, in a tagged document: add the document's
   * paragraphs, headings and tables under it with `add()`, in reading order, and tie content
   * to them with `page.beginContent(element)`.
   */
  get structure(): PdfStructElement {
    if (!this.#structure) throw new Error("This document is not tagged: pass tagged: true");
    return this.#structure;
  }

  /** Whether the document carries a logical structure. */
  get tagged(): boolean {
    return this.#structure !== undefined;
  }

  get pageCount(): number {
    return this.#pages.length;
  }

  #host(): PageHost {
    return {
      writer: this.writer,
      pagesRef: this.#pagesRef,
      opacityState: (fill, stroke) => this.#opacityState(fill, stroke),
      fontResource: (font) => this.#fontResource(font),
      imageResource: (image) => this.#imageResource(image),
      spotColorResource: (color) => this.#spotColor(color),
      defaultColorSpace: (space) => this.#defaultColorSpace(space),
      ...(this.#structure
        ? {
            structure: {
              nextKey: () => this.#parents.push(null) - 1,
              setParent: (key, value) => {
                this.#parents[key] = value;
              },
            },
          }
        : {}),
    };
  }

  /** Starts a new page. Draw on it through `page.content`. */
  addPage(options: PdfPageOptions): PdfPage {
    const page = new PdfPage(this.#host(), options);
    this.#pages.push(page);
    return page;
  }

  /**
   * Starts a drawing that is stored once and can be placed on many pages with
   * `page.content.form(form)`: a logo, a background pattern. `bbox` is the rectangle it
   * occupies, as `[x1, y1, x2, y2]`. Draw on it through `form.content`.
   */
  createForm(bbox: Box): PdfForm {
    const form = new PdfForm(this.#host(), `Fm${this.#forms.length + 1}`, bbox);
    this.#forms.push(form);
    return form;
  }

  /**
   * Names a place in the document that links and bookmarks can point to.
   *
   * @param top distance of the place from the bottom of the page, in the page's coordinates;
   *   a viewer scrolls so that it is at the top of the window
   */
  addDestination(name: string, page: PdfPage, left: number, top: number): void {
    if (!this.#destinations.has(name))
      this.#destinations.set(name, [page.ref, new PdfName("XYZ"), left, top, null]);
  }

  /**
   * Adds a bookmark to the document's outline (the navigation panel of a viewer). Bookmarks
   * nest by `level`: a level-2 bookmark goes under the level-1 bookmark before it.
   */
  addBookmark(title: string, level: number, page: PdfPage, top: number): void {
    this.#bookmarks.push({
      title,
      level: Math.max(1, Math.floor(level)),
      dest: [page.ref, new PdfName("XYZ"), null, top, null],
    });
  }

  /** Writes the outline tree and returns its root, or undefined when there are no bookmarks. */
  #outline(): PdfRef | undefined {
    if (this.#bookmarks.length === 0) return undefined;
    const writer = this.writer;
    interface Node {
      ref: PdfRef;
      title: string;
      dest: PdfObject;
      level: number;
      parent: Node | undefined;
      children: Node[];
    }
    const root: Node = {
      ref: writer.allocate(),
      title: "",
      dest: null,
      level: 0,
      parent: undefined,
      children: [],
    };
    let last = root;
    for (const bookmark of this.#bookmarks) {
      // Climb to the nearest ancestor of a lower level; a skipped level nests one step only.
      let parent = last;
      while (parent.level >= bookmark.level && parent.parent) parent = parent.parent;
      const node: Node = {
        ref: writer.allocate(),
        title: bookmark.title,
        dest: bookmark.dest,
        level: bookmark.level,
        parent,
        children: [],
      };
      parent.children.push(node);
      last = node;
    }
    /** Number of bookmarks under a node, all of them shown open. */
    const count = (node: Node): number =>
      node.children.reduce((sum, child) => sum + 1 + count(child), 0);
    const write = (node: Node): void => {
      node.children.forEach((child, i) => {
        write(child);
        writer.set(
          child.ref,
          new PdfDict({
            Title: PdfString.text(child.title),
            Parent: node.ref,
            Prev: node.children[i - 1]?.ref,
            Next: node.children[i + 1]?.ref,
            First: child.children[0]?.ref,
            Last: child.children.at(-1)?.ref,
            Count: child.children.length > 0 ? count(child) : undefined,
            Dest: child.dest,
          }),
        );
      });
    };
    write(root);
    writer.set(
      root.ref,
      new PdfDict({
        Type: new PdfName("Outlines"),
        First: root.children[0]?.ref,
        Last: root.children.at(-1)?.ref,
        Count: count(root),
      }),
    );
    return root.ref;
  }

  /** Completes the file and returns its bytes. The document cannot be used afterwards. */
  finish(): Uint8Array {
    const writer = this.writer;
    if (this.#pages.length === 0) throw new Error("A PDF needs at least one page");
    for (const page of this.#pages) page.end();
    for (const form of this.#forms) form.end();
    for (const { font, ref } of this.#embedded) font.write(writer, ref);
    writer.set(
      this.#pagesRef,
      new PdfDict({
        Type: new PdfName("Pages"),
        Kids: this.#pages.map((page) => page.ref),
        Count: this.#pages.length,
      }),
    );
    if ((this.#print || this.#archive || this.#accessible) && this.#usesStandardFonts) {
      const standard = this.#print ? "PDF/X-4" : this.#archive ? "PDF/A" : "PDF/UA";
      throw new Error(
        `${standard} requires every font to be embedded; the 14 standard fonts cannot be used`,
      );
    }
    if (this.#print) {
      for (const page of this.#pages) {
        if (!page.trimBox) throw new Error("PDF/X-4 requires a trim box on every page");
      }
    }
    const intent = this.#outputIntent;
    // One entry per standard that reads it; they share the profile.
    const purposes = [
      ...(this.#print || !this.#archive ? ["GTS_PDFX"] : []),
      ...(this.#archive ? ["GTS_PDFA1"] : []),
    ];
    const outputIntents = intent
      ? purposes.map(
          (purpose) =>
            new PdfDict({
              Type: new PdfName("OutputIntent"),
              S: new PdfName(purpose),
              OutputConditionIdentifier: PdfString.text(intent.identifier),
              Info: PdfString.text(intent.info ?? intent.identifier),
              RegistryName: PdfString.text(intent.registry ?? "http://www.color.org"),
              DestOutputProfile: this.#profile(),
            }),
        )
      : undefined;
    const infoDict = this.#infoDict();
    const outline = this.#outline();
    const destinations =
      this.#destinations.size > 0 ? new PdfDict(Object.fromEntries(this.#destinations)) : undefined;
    let structTree: PdfRef | undefined;
    if (this.#structure && this.#structRoot) {
      this.#structure.write();
      structTree = this.#structRoot;
      writer.set(
        structTree,
        new PdfDict({
          Type: new PdfName("StructTreeRoot"),
          K: this.#structure.ref,
          ParentTree: writer.add(
            new PdfDict({ Nums: this.#parents.flatMap((value, key) => [key, value]) }),
          ),
          ParentTreeNextKey: this.#parents.length,
        }),
      );
    }
    const root = writer.add(
      new PdfDict({
        Type: new PdfName("Catalog"),
        Pages: this.#pagesRef,
        Lang: this.#lang === undefined ? undefined : PdfString.text(this.#lang),
        // Kept uncompressed so that tools which only look for the packet can find it.
        Metadata: writer.add(
          new PdfStream(
            this.#xmp(),
            new PdfDict({ Type: new PdfName("Metadata"), Subtype: new PdfName("XML") }),
            { compress: false },
          ),
        ),
        OutputIntents: outputIntents,
        Dests: destinations,
        Outlines: outline,
        // Open the bookmarks panel when the document has bookmarks.
        PageMode: outline ? new PdfName("UseOutlines") : undefined,
        MarkInfo: structTree ? new PdfDict({ Marked: true }) : undefined,
        StructTreeRoot: structTree,
        // A reader announces the title rather than the file name.
        ViewerPreferences:
          structTree && this.#info.title ? new PdfDict({ DisplayDocTitle: true }) : undefined,
      }),
    );
    const info = writer.add(infoDict);
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

  /** The output intent's profile, written once. */
  #profile(): PdfRef {
    const intent = this.#outputIntent as OutputIntent;
    this.#intentProfile ??= this.writer.add(
      new PdfStream(intent.profile, new PdfDict({ N: iccComponents(intent.profile) })),
    );
    return this.#intentProfile;
  }

  /**
   * In an archived file a plain colour must agree with the output intent or be read through
   * a profile of its own. RGB can always be: sRGB is built in. CMYK has no such default.
   */
  #defaultColorSpace(space: "rgb" | "cmyk"): { name: string; ref: PdfRef } | undefined {
    if (!this.#archive) return undefined;
    const intent = this.#outputIntent as OutputIntent;
    const components = iccComponents(intent.profile);
    if (space === "cmyk") {
      if (components === 4) return undefined;
      throw new Error(
        "PDF/A: CMYK and spot colours need a CMYK output intent (the profile of the printing condition)",
      );
    }
    if (components === 3) return undefined;
    this.#srgb ??= {
      name: "DefaultRGB",
      ref: this.writer.add([
        new PdfName("ICCBased"),
        this.writer.add(new PdfStream(srgbProfile(), new PdfDict({ N: 3 }))),
      ]),
    };
    return this.#srgb;
  }

  /** One Separation colour space per ink, whatever tints of it are used. */
  #spotColor(color: Extract<Color, { space: "spot" }>): { name: string; ref: PdfRef } {
    let resource = this.#spots.get(color.name);
    if (!resource) {
      const { c, m, y, k } = color.alternate;
      const ref = this.writer.add([
        new PdfName("Separation"),
        new PdfName(color.name),
        new PdfName("DeviceCMYK"),
        // Tint 0 is bare paper, tint 1 the alternate colour, and in between a straight line.
        new PdfDict({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [c, m, y, k], N: 1 }),
      ]);
      resource = { name: `CS${this.#spots.size + 1}`, ref };
      this.#spots.set(color.name, resource);
    }
    return resource;
  }

  /** One XObject per image, however many times and on however many pages it is drawn. */
  #imageResource(image: PdfImage): { name: string; ref: PdfRef } {
    let resource = this.#images.get(image);
    if (!resource) {
      resource = { name: `Im${this.#images.size + 1}`, ref: writeImage(this.writer, image) };
      this.#images.set(image, resource);
    }
    return resource;
  }

  /** One font object per font, shared by every page that uses it. */
  #fontResource(font: AnyFont): FontBinding & { ref: PdfRef } {
    let resource = this.#fonts.get(font);
    if (resource) return resource;
    const name = `F${this.#fonts.size + 1}`;
    if (font instanceof StandardFont) {
      this.#usesStandardFonts = true;
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

  /** The dates to stamp the file with; none in deterministic mode unless given. */
  #dates(): { created: Date | undefined; modified: Date | undefined } {
    this.#now ??= new Date();
    const created = this.#info.creationDate ?? (this.#deterministic ? undefined : this.#now);
    return { created, modified: this.#info.modDate ?? created };
  }

  /** The XMP metadata packet: the same details as the information dictionary, as XML. */
  #xmp(): Uint8Array {
    const info = this.#info;
    const { created, modified } = this.#dates();
    const xmlText = (value: string): string =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const date = (value: Date): string => value.toISOString().replace(/\.\d+Z$/, "Z");
    const lines: string[] = [];
    if (info.title !== undefined) {
      lines.push(
        `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(info.title)}</rdf:li></rdf:Alt></dc:title>`,
      );
    }
    if (info.author !== undefined) {
      lines.push(
        `<dc:creator><rdf:Seq><rdf:li>${xmlText(info.author)}</rdf:li></rdf:Seq></dc:creator>`,
      );
    }
    if (info.subject !== undefined) {
      lines.push(
        `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(info.subject)}</rdf:li></rdf:Alt></dc:description>`,
      );
    }
    if (info.keywords !== undefined)
      lines.push(`<pdf:Keywords>${xmlText(info.keywords)}</pdf:Keywords>`);
    lines.push(`<pdf:Producer>${xmlText(info.producer ?? "mbingpdf")}</pdf:Producer>`);
    if (info.creator !== undefined)
      lines.push(`<xmp:CreatorTool>${xmlText(info.creator)}</xmp:CreatorTool>`);
    if (created) lines.push(`<xmp:CreateDate>${date(created)}</xmp:CreateDate>`);
    if (modified) {
      lines.push(`<xmp:ModifyDate>${date(modified)}</xmp:ModifyDate>`);
      lines.push(`<xmp:MetadataDate>${date(modified)}</xmp:MetadataDate>`);
    }
    if (this.#print) {
      lines.push("<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>");
      lines.push("<pdf:Trapped>False</pdf:Trapped>");
    }
    if (this.#archive) {
      lines.push(`<pdfaid:part>${this.#archive.part}</pdfaid:part>`);
      lines.push(`<pdfaid:conformance>${this.#archive.level}</pdfaid:conformance>`);
      // PDF/A accepts only properties it knows or that the file itself describes.
      const described = extensionSchemas([
        ...(this.#print ? [PDFX_SCHEMA, TRAPPED_SCHEMA] : []),
        ...(this.#accessible ? [PDFUA_SCHEMA] : []),
      ]);
      if (described) lines.push(described);
    }
    if (this.#accessible) lines.push("<pdfuaid:part>1</pdfuaid:part>");
    const xml =
      '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
      'xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" ' +
      'xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" ' +
      'xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" ' +
      'xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">\n' +
      `${lines.join("\n")}\n` +
      "</rdf:Description>\n</rdf:RDF>\n</x:xmpmeta>\n" +
      '<?xpacket end="w"?>';
    return new TextEncoder().encode(xml);
  }

  #infoDict(): PdfDict {
    const info = this.#info;
    const text = (value: string | undefined): PdfObject | undefined =>
      value === undefined ? undefined : PdfString.text(value);
    const { created, modified } = this.#dates();
    return new PdfDict({
      Title: text(info.title),
      Author: text(info.author),
      Subject: text(info.subject),
      Keywords: text(info.keywords),
      Creator: text(info.creator),
      Producer: PdfString.text(info.producer ?? "mbingpdf"),
      CreationDate: created && PdfString.date(created),
      ModDate: modified && PdfString.date(modified),
      ...(this.#print
        ? { GTS_PDFXVersion: PdfString.text("PDF/X-4"), Trapped: new PdfName("False") }
        : {}),
    });
  }
}

/** Number of colour components of an ICC profile, from the colour space in its header. */
function iccComponents(profile: Uint8Array): number {
  const space = String.fromCharCode(...profile.subarray(16, 20));
  return space === "CMYK" ? 4 : space === "GRAY" ? 1 : 3;
}

/** A group of metadata properties that PDF/A does not know and must be told about. */
interface MetadataSchema {
  readonly name: string;
  readonly uri: string;
  readonly prefix: string;
  readonly properties: readonly {
    readonly name: string;
    readonly type: string;
    readonly description: string;
  }[];
}

const PDFX_SCHEMA: MetadataSchema = {
  name: "PDF/X identification",
  uri: "http://www.npes.org/pdfx/ns/id/",
  prefix: "pdfxid",
  properties: [
    { name: "GTS_PDFXVersion", type: "Text", description: "The PDF/X version of the file" },
  ],
};

const PDFUA_SCHEMA: MetadataSchema = {
  name: "PDF/UA identification",
  uri: "http://www.aiim.org/pdfua/ns/id/",
  prefix: "pdfuaid",
  properties: [{ name: "part", type: "Integer", description: "The part of PDF/UA the file meets" }],
};

const TRAPPED_SCHEMA: MetadataSchema = {
  name: "Adobe PDF",
  uri: "http://ns.adobe.com/pdf/1.3/",
  prefix: "pdf",
  properties: [{ name: "Trapped", type: "Text", description: "Whether the file has been trapped" }],
};

/** The XMP block that describes metadata properties from outside the PDF/A set. */
function extensionSchemas(schemas: readonly MetadataSchema[]): string | undefined {
  if (schemas.length === 0) return undefined;
  const items = schemas.map((schema) => {
    const properties = schema.properties
      .map(
        (property) =>
          '<rdf:li rdf:parseType="Resource">' +
          `<pdfaProperty:name>${property.name}</pdfaProperty:name>` +
          `<pdfaProperty:valueType>${property.type}</pdfaProperty:valueType>` +
          "<pdfaProperty:category>internal</pdfaProperty:category>" +
          `<pdfaProperty:description>${property.description}</pdfaProperty:description>` +
          "</rdf:li>",
      )
      .join("");
    return (
      '<rdf:li rdf:parseType="Resource">' +
      `<pdfaSchema:schema>${schema.name}</pdfaSchema:schema>` +
      `<pdfaSchema:namespaceURI>${schema.uri}</pdfaSchema:namespaceURI>` +
      `<pdfaSchema:prefix>${schema.prefix}</pdfaSchema:prefix>` +
      `<pdfaSchema:property><rdf:Seq>${properties}</rdf:Seq></pdfaSchema:property>` +
      "</rdf:li>"
    );
  });
  return (
    '<pdfaExtension:schemas xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" ' +
    'xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" ' +
    'xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">' +
    `<rdf:Bag>${items.join("")}</rdf:Bag></pdfaExtension:schemas>`
  );
}
