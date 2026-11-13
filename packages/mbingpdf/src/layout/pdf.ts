/** The PDF backend: writes a display list to a page of a PDF document. */
import {
  type AnyFont,
  type ContentStream,
  cmyk,
  type LinkOptions,
  PdfDict,
  type PdfDocument,
  type PdfForm,
  type PdfPage,
  PdfString,
  type PdfStructElement,
} from "../core/index.ts";
import type { DisplayItem, DisplayPage, PathCommand, SharedItem, StructureTag } from "./display.ts";

/** What links, anchors and headings turn into; they belong to a page, not to its drawing. */
interface Hooks {
  link(item: Extract<DisplayItem, { type: "link" }>, options: LinkOptions): void;
  anchor(item: Extract<DisplayItem, { type: "anchor" }>): void;
  heading(item: Extract<DisplayItem, { type: "heading" }>): void;
}

const NO_HOOKS: Hooks = { link: () => {}, anchor: () => {}, heading: () => {} };

/** The artwork already stored in each document, by its array of items. */
const stored: WeakMap<PdfDocument, WeakMap<readonly DisplayItem[], PdfForm>> = new WeakMap();

/** The stored form of a piece of shared artwork, drawing it the first time it is met. */
function formFor(document: PdfDocument, item: SharedItem): PdfForm {
  let forms = stored.get(document);
  if (!forms) {
    forms = new WeakMap();
    stored.set(document, forms);
  }
  let form = forms.get(item.items);
  if (!form) {
    form = document.createForm([0, 0, item.width, item.height]);
    // Display items measure down from the top; a form measures up from its bottom.
    form.content.transform(1, 0, 0, -1, 0, item.height);
    drawItems(document, form.content, item.items, NO_HOOKS, undefined);
    form.end();
    forms.set(item.items, form);
  }
  return form;
}

/**
 * The elements made so far for each document, by their parent and their key: an element that
 * continues on a later page is found here and added to.
 */
const elements: WeakMap<PdfStructElement, Map<object, PdfStructElement>> = new WeakMap();

/** The element a tagged item stands for: the one begun on an earlier page, or a new one. */
function elementFor(parent: PdfStructElement, tag: StructureTag): PdfStructElement {
  let known = elements.get(parent);
  if (tag.key !== undefined && tag.continued) {
    const begun = known?.get(tag.key);
    if (begun) return begun;
  }
  const element = parent.add(tag.role as Exclude<StructureTag["role"], "Artifact">, {
    ...(tag.alt !== undefined ? { alt: tag.alt } : {}),
    ...(tag.scope !== undefined ? { scope: tag.scope } : {}),
    ...(tag.colSpan !== undefined ? { colSpan: tag.colSpan } : {}),
  });
  if (tag.key !== undefined) {
    if (!known) {
      known = new Map();
      elements.set(parent, known);
    }
    known.set(tag.key, element);
  }
  return element;
}

/**
 * Keeps what is drawn on a tagged page inside marked content: each mark belongs either to an
 * element of the structure or to an artifact. A run is opened when the first mark needs it
 * and closed when the next one belongs elsewhere.
 */
class Marker {
  readonly #page: PdfPage;
  #open: PdfStructElement | StructureTag | undefined;

  constructor(page: PdfPage) {
    this.#page = page;
  }

  /** Makes sure the marks that follow belong to `owner`: an element, or an artifact's tag. */
  enter(owner: PdfStructElement | StructureTag): void {
    if (this.#open === owner) return;
    this.close();
    if ("add" in owner) this.#page.beginContent(owner);
    else {
      this.#page.beginArtifact(
        owner.furniture ? { type: "Pagination", subtype: owner.furniture } : {},
      );
    }
    this.#open = owner;
  }

  close(): void {
    if (this.#open) this.#page.endContent();
    this.#open = undefined;
  }
}

const PLAIN_ARTIFACT: StructureTag = { role: "Artifact" };

/** Where drawing stands in a tagged document. */
interface Tagging {
  readonly marker: Marker;
  /** The element that content belongs to. */
  readonly element: PdfStructElement;
  /** Set inside an artifact: everything is furniture, whatever tags it carries. */
  readonly artifact?: StructureTag;
}

function tracePath(content: ContentStream, commands: readonly PathCommand[]): void {
  for (const command of commands) {
    if (command[0] === "M") content.moveTo(command[1], command[2]);
    else if (command[0] === "L") content.lineTo(command[1], command[2]);
    else if (command[0] === "R") content.rect(command[1], command[2], command[3], command[4]);
    else if (command[0] === "C") {
      content.curveTo(command[1], command[2], command[3], command[4], command[5], command[6]);
    } else content.closePath();
  }
}

function drawItems(
  document: PdfDocument,
  content: ContentStream,
  items: readonly DisplayItem[],
  hooks: Hooks,
  tagging: Tagging | undefined,
): void {
  // Rules, backgrounds and underlines are decoration, except inside a figure, where the
  // shapes are the picture. Text and images are always content.
  const shapes =
    tagging?.artifact ?? (tagging?.element.role === "Figure" ? tagging.element : PLAIN_ARTIFACT);
  const marks = tagging?.artifact ?? tagging?.element;
  for (const item of items) {
    switch (item.type) {
      case "path": {
        tagging?.marker.enter(shapes);
        const stroke = item.stroke;
        if (stroke) {
          content.save().strokeColor(stroke.color).lineWidth(stroke.width);
          if (stroke.dash) content.dash(stroke.dash);
          if (stroke.cap) content.lineCap(stroke.cap);
          if (stroke.join) content.lineJoin(stroke.join);
        }
        if (item.fill) content.fillColor(item.fill);
        tracePath(content, item.commands);
        const rule = item.evenOdd ? "evenodd" : "nonzero";
        if (item.fill && stroke) content.fillAndStroke(rule);
        else if (stroke) content.stroke();
        else if (item.fill) content.fill(rule);
        else content.endPath();
        if (stroke) content.restore();
        break;
      }
      case "text": {
        if (marks) tagging?.marker.enter(marks);
        // The page is drawn with y pointing down; flipping the text matrix stands the glyphs
        // back upright.
        // Letter-spaced text would be copied with a space inside every word: the gaps are
        // as wide as some readers take a word space to be. So the spacing is written as
        // character spacing (`Tc`), which readers know is not a gap, and ActualText gives the
        // words to those that go by the gaps all the same. Glyphs that share a cluster keep
        // their own advances: `Tc` would push a mark off its letter.
        const tracking = item.letterSpacing;
        const single =
          tracking !== undefined &&
          item.glyphs.every((glyph, i) => glyph.cluster !== item.glyphs[i + 1]?.cluster);
        if (tracking !== undefined) {
          content.beginMarkedContent(
            "Span",
            new PdfDict({ ActualText: PdfString.text(item.text) }),
          );
        }
        content
          .fillColor(item.color)
          .font(item.font as AnyFont, item.size)
          .beginText()
          .textMatrix(1, 0, 0, -1, item.x, item.y);
        if (single) {
          const units = (tracking * item.font.unitsPerEm) / item.size;
          content
            .characterSpacing(tracking)
            .showGlyphs(
              item.glyphs.map((glyph) => ({ ...glyph, xAdvance: glyph.xAdvance - units })),
              item.text,
            )
            .characterSpacing(0);
        } else content.showGlyphs(item.glyphs, item.text);
        content.endText();
        if (tracking !== undefined) content.endMarkedContent();
        break;
      }
      case "image":
        if (marks) tagging?.marker.enter(marks);
        if (item.clip) {
          content.save().rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height).clip();
        }
        content.image(item.image, item.x, item.y + item.height, item.width, -item.height);
        if (item.clip) content.restore();
        break;
      case "link": {
        if (!tagging) {
          hooks.link(item, {});
          break;
        }
        // A link's clickable area belongs to a Link element; one outside any (in a running
        // foot, say) gets an element of its own.
        const element =
          tagging.element.role === "Link" && !tagging.artifact
            ? tagging.element
            : (document.structure as PdfStructElement).add("Link");
        hooks.link(item, { element, description: item.url ?? `Go to ${item.target}` });
        break;
      }
      case "anchor":
        hooks.anchor(item);
        break;
      case "heading":
        hooks.heading(item);
        break;
      case "group":
        // A run of marked content may not straddle a change of graphics state.
        tagging?.marker.close();
        content.save();
        if (item.rotate) content.rotate(item.rotate.degrees, item.rotate.cx, item.rotate.cy);
        if (item.opacity !== undefined) content.opacity(item.opacity);
        drawItems(document, content, item.items, hooks, tagging);
        tagging?.marker.close();
        content.restore();
        break;
      case "tagged": {
        if (!tagging || tagging.artifact) {
          drawItems(document, content, item.items, hooks, tagging);
          break;
        }
        const inner: Tagging =
          item.tag.role === "Artifact"
            ? { ...tagging, artifact: item.tag }
            : { ...tagging, element: elementFor(tagging.element, item.tag) };
        drawItems(document, content, item.items, hooks, inner);
        break;
      }
      case "shared":
        if (marks) tagging?.marker.enter(marks);
        // Stored once in the file; here it is only placed. The form's origin is its bottom-left
        // corner, which sits `height × scale` below the item's top-left corner.
        content.save();
        if (item.clip) {
          content.rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height).clip();
        }
        content
          .transform(item.scale, 0, 0, -item.scale, item.x, item.y + item.height * item.scale)
          .form(formFor(document, item))
          .restore();
        break;
    }
  }
}

const MM = 72 / 25.4;
/** Room left outside the bleed when printer's marks are drawn. */
const MARKS_MARGIN = 10 * MM;

/** Adds a page to the document and draws the display list on it. */
export function writeDisplayPage(
  document: PdfDocument,
  page: DisplayPage,
  options: { boxes?: boolean; bookmarks?: boolean } = {},
): void {
  const bleed = page.bleed ?? 0;
  const margin = page.marks ? MARKS_MARGIN : 0;
  // The sheet is the finished page plus bleed plus room for marks on every side.
  const offset = bleed + margin;
  const sheetWidth = page.width + offset * 2;
  const sheetHeight = page.height + offset * 2;
  // Print standards want the trim size stated even when it is the whole sheet.
  const printed = bleed > 0 || page.marks !== undefined || options.boxes === true;
  const pdfPage = document.addPage({
    size: [sheetWidth, sheetHeight],
    ...(printed
      ? {
          trimBox: [offset, offset, offset + page.width, offset + page.height],
          bleedBox: [margin, margin, sheetWidth - margin, sheetHeight - margin],
        }
      : {}),
  });
  const content = pdfPage.content;
  const marker = document.tagged ? new Marker(pdfPage) : undefined;
  const tagging: Tagging | undefined = marker ? { marker, element: document.structure } : undefined;
  // The display list measures from the top-left corner of the finished page; PDF measures
  // from the bottom-left corner of the sheet.
  content.transform(1, 0, 0, -1, offset, offset + page.height);
  if (printed) {
    // Nothing may spill past the bleed into the marks.
    content
      .save()
      .rect(-bleed, -bleed, page.width + bleed * 2, page.height + bleed * 2)
      .clip();
  }
  // Display coordinates measure down from the top of the finished page; these turn them into
  // the sheet's own, which measure up from its bottom-left corner.
  const sheetX = (x: number): number => x + offset;
  const sheetY = (y: number): number => offset + page.height - y;
  const hooks: Hooks = {
    link: (item, options) => {
      const bottom = sheetY(item.y + item.height);
      if (item.url !== undefined)
        pdfPage.addLink(sheetX(item.x), bottom, item.width, item.height, item.url, options);
      else if (item.target !== undefined) {
        pdfPage.addInternalLink(
          sheetX(item.x),
          bottom,
          item.width,
          item.height,
          item.target,
          options,
        );
      }
    },
    anchor: (item) => document.addDestination(item.id, pdfPage, sheetX(item.x), sheetY(item.y)),
    heading: (item) => {
      if (options.bookmarks !== false)
        document.addBookmark(item.title, item.level, pdfPage, sheetY(item.y));
    },
  };
  drawItems(document, content, page.items, hooks, tagging);
  marker?.close();
  if (printed) content.restore();

  if (page.marks) {
    // Marks print on every plate: registration colour is all four process inks at full.
    const gap = bleed + 2 * MM;
    const length = 5 * MM;
    marker?.enter(PLAIN_ARTIFACT);
    content
      .save()
      .strokeColor(cmyk(1, 1, 1, 1))
      .lineWidth(0.25);
    if (page.marks.crop) {
      for (const x of [0, page.width]) {
        for (const y of [0, page.height]) {
          const outwardX = x === 0 ? -1 : 1;
          const outwardY = y === 0 ? -1 : 1;
          content.moveTo(x + outwardX * gap, y).lineTo(x + outwardX * (gap + length), y);
          content.moveTo(x, y + outwardY * gap).lineTo(x, y + outwardY * (gap + length));
        }
      }
      content.stroke();
    }
    if (page.marks.registration) {
      const radius = 1.5 * MM;
      const arm = 2.5 * MM;
      const distance = bleed + margin / 2;
      const targets: [number, number][] = [
        [page.width / 2, -distance],
        [page.width / 2, page.height + distance],
        [-distance, page.height / 2],
        [page.width + distance, page.height / 2],
      ];
      for (const [x, y] of targets) {
        content.circle(x, y, radius).stroke();
        content
          .moveTo(x - arm, y)
          .lineTo(x + arm, y)
          .moveTo(x, y - arm)
          .lineTo(x, y + arm)
          .stroke();
      }
    }
    content.restore();
    marker?.close();
  }
  pdfPage.end();
}
