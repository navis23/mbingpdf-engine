import type { Color } from "./color.ts";
import {
  type AnyFont,
  type ContentResources,
  ContentStream,
  type FontBinding,
  type FormResource,
} from "./content.ts";
import type { PdfImage } from "./image.ts";
import { PdfDict, PdfName, type PdfObject, type PdfRef, PdfStream, PdfString } from "./objects.ts";
import type { Box, PageSize } from "./units.ts";
import type { PdfWriter } from "./writer.ts";

export interface PdfPageOptions {
  /** Width and height of the sheet (the MediaBox) in points. */
  size: PageSize;
  /** The finished size after trimming. Must lie inside the sheet. */
  trimBox?: Box;
  /** The area artwork may fill before trimming. Must contain the trim box. */
  bleedBox?: Box;
}

/** What a page needs from the document that owns it. */
export interface PageHost {
  readonly writer: PdfWriter;
  readonly pagesRef: PdfRef;
  /** A shared graphics state with the given opacities. */
  opacityState(fill: number | undefined, stroke: number | undefined): { name: string; ref: PdfRef };
  /** The document-wide colour space for a spot colour. */
  spotColorResource(color: Extract<Color, { space: "spot" }>): { name: string; ref: PdfRef };
  /** The document-wide XObject for an image. */
  imageResource(image: PdfImage): { name: string; ref: PdfRef };
  /** The document-wide font object and encoder for a font. */
  fontResource(font: AnyFont): FontBinding & { ref: PdfRef };
}

/** Resource hooks for a content stream: each thing used is noted under its name. */
function contentResources(
  host: PageHost,
  set: (category: string, name: string, ref: PdfRef) => void,
): ContentResources {
  return {
    opacity: (fill, stroke) => {
      const state = host.opacityState(fill, stroke);
      set("ExtGState", state.name, state.ref);
      return state.name;
    },
    font: (font) => {
      const resource = host.fontResource(font);
      set("Font", resource.name, resource.ref);
      return resource;
    },
    image: (image) => {
      const resource = host.imageResource(image);
      set("XObject", resource.name, resource.ref);
      return resource.name;
    },
    spotColor: (color) => {
      const resource = host.spotColorResource(color);
      set("ColorSpace", resource.name, resource.ref);
      return resource.name;
    },
    form: (form) => {
      set("XObject", form.name, form.ref);
      return form.name;
    },
  };
}

function resourceDict(resources: Map<string, Map<string, PdfRef>>): PdfDict {
  const dict = new PdfDict();
  for (const [category, entries] of resources) {
    dict.set(category, new PdfDict(Object.fromEntries(entries)));
  }
  return dict;
}

/**
 * A drawing that is written to the file once and can be placed on any number of pages (a Form
 * XObject): a logo, a background, anything repeated. Draw on `content`, in a space whose
 * origin is the lower-left corner of `bbox`; then place it with `ContentStream.form()`.
 */
export class PdfForm implements FormResource {
  readonly ref: PdfRef;
  /** The name pages use for it in their resources. */
  readonly name: string;
  /** The rectangle the drawing occupies; anything outside it is cut off. */
  readonly bbox: Box;
  readonly #host: PageHost;
  readonly #content: ContentStream;
  readonly #resources: Map<string, Map<string, PdfRef>> = new Map();
  #ended = false;

  constructor(host: PageHost, name: string, bbox: Box) {
    checkBox(bbox, "bbox");
    this.#host = host;
    this.ref = host.writer.allocate();
    this.name = name;
    this.bbox = bbox;
    this.#content = new ContentStream(
      contentResources(host, (category, resourceName, ref) => {
        let entries = this.#resources.get(category);
        if (!entries) {
          entries = new Map();
          this.#resources.set(category, entries);
        }
        entries.set(resourceName, ref);
      }),
    );
  }

  /** The form's drawing surface. */
  get content(): ContentStream {
    if (this.#ended) throw new Error("This form is already written");
    return this.#content;
  }

  /**
   * Writes the form to the file and releases its content. Called automatically when the
   * document finishes. A form can be placed on pages before or after it is written.
   */
  end(): void {
    if (this.#ended) return;
    const bytes = this.#content.toBytes();
    this.#ended = true;
    this.#host.writer.set(
      this.ref,
      new PdfStream(
        bytes,
        new PdfDict({
          Type: new PdfName("XObject"),
          Subtype: new PdfName("Form"),
          BBox: this.bbox,
          Resources: resourceDict(this.#resources),
        }),
      ),
    );
  }
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
  );
}

function checkBox(box: Box, label: string): void {
  if (!(box[2] > box[0] && box[3] > box[1])) {
    throw new RangeError(`${label} must be [x1, y1, x2, y2] with x2 > x1 and y2 > y1`);
  }
}

/** One page: its boxes, its resources and its content stream. */
export class PdfPage {
  readonly ref: PdfRef;
  readonly width: number;
  readonly height: number;
  readonly trimBox: Box | undefined;
  readonly bleedBox: Box | undefined;
  readonly #host: PageHost;
  readonly #content: ContentStream;
  /** Resource category (`ExtGState`, `Font`, …) → resource name → object. */
  readonly #resources: Map<string, Map<string, PdfRef>> = new Map();
  readonly #annotations: PdfObject[] = [];
  #ended = false;

  constructor(host: PageHost, options: PdfPageOptions) {
    const [width, height] = options.size;
    if (!(width > 0 && height > 0)) throw new RangeError("Page width and height must be positive");
    const media: Box = [0, 0, width, height];
    if (options.bleedBox) {
      checkBox(options.bleedBox, "bleedBox");
      if (!contains(media, options.bleedBox)) {
        throw new RangeError("bleedBox must lie inside the page");
      }
    }
    if (options.trimBox) {
      checkBox(options.trimBox, "trimBox");
      if (!contains(options.bleedBox ?? media, options.trimBox)) {
        throw new RangeError("trimBox must lie inside the bleed box and the page");
      }
    }
    this.#host = host;
    this.ref = host.writer.allocate();
    this.width = width;
    this.height = height;
    this.trimBox = options.trimBox;
    this.bleedBox = options.bleedBox;
    this.#content = new ContentStream(
      contentResources(host, (category, name, ref) => this.setResource(category, name, ref)),
    );
  }

  /** The page's drawing surface. */
  get content(): ContentStream {
    if (this.#ended) throw new Error("This page is already written");
    return this.#content;
  }

  /** Registers an object under a name in one of the page's resource categories. */
  setResource(category: string, resourceName: string, ref: PdfRef): void {
    if (this.#ended) throw new Error("This page is already written");
    let entries = this.#resources.get(category);
    if (!entries) {
      entries = new Map();
      this.#resources.set(category, entries);
    }
    entries.set(resourceName, ref);
  }

  /**
   * Makes a rectangle of the page a link to a web address. The rectangle is in the page's own
   * coordinates: lower-left corner, width and height.
   */
  addLink(x: number, y: number, width: number, height: number, url: string): void {
    if (this.#ended) throw new Error("This page is already written");
    this.#annotations.push(
      new PdfDict({
        Type: new PdfName("Annot"),
        Subtype: new PdfName("Link"),
        Rect: [x, y, x + width, y + height],
        Border: [0, 0, 0],
        A: new PdfDict({
          Type: new PdfName("Action"),
          S: new PdfName("URI"),
          URI: PdfString.text(url),
        }),
      }),
    );
  }

  /**
   * Makes a rectangle of the page a link to a place in this document, named with
   * `PdfDocument.addDestination`. The destination may be added later, on a later page.
   */
  addInternalLink(x: number, y: number, width: number, height: number, destination: string): void {
    if (this.#ended) throw new Error("This page is already written");
    this.#annotations.push(
      new PdfDict({
        Type: new PdfName("Annot"),
        Subtype: new PdfName("Link"),
        Rect: [x, y, x + width, y + height],
        Border: [0, 0, 0],
        Dest: new PdfName(destination),
      }),
    );
  }

  /**
   * Writes the page to the file and releases its content. Called automatically when the
   * document finishes; call it earlier to free memory in long documents.
   */
  end(): void {
    if (this.#ended) return;
    const writer = this.#host.writer;
    const bytes = this.#content.toBytes();
    this.#ended = true;

    writer.set(
      this.ref,
      new PdfDict({
        Type: new PdfName("Page"),
        Parent: this.#host.pagesRef,
        MediaBox: [0, 0, this.width, this.height],
        BleedBox: this.bleedBox,
        TrimBox: this.trimBox,
        Resources: resourceDict(this.#resources),
        Contents: bytes.length > 0 ? writer.add(new PdfStream(bytes)) : undefined,
        Annots:
          this.#annotations.length > 0
            ? this.#annotations.map((annotation) => writer.add(annotation))
            : undefined,
      }),
    );
  }
}
