/** The PDF backend: writes a display list to a page of a PDF document. */
import { type AnyFont, type ContentStream, cmyk, type PdfDocument } from "../core/index.ts";
import type { DisplayItem, DisplayPage, PathCommand } from "./display.ts";

function tracePath(content: ContentStream, commands: readonly PathCommand[]): void {
  for (const command of commands) {
    if (command[0] === "M") content.moveTo(command[1], command[2]);
    else if (command[0] === "L") content.lineTo(command[1], command[2]);
    else if (command[0] === "C") {
      content.curveTo(command[1], command[2], command[3], command[4], command[5], command[6]);
    } else content.closePath();
  }
}

function drawItems(
  content: ContentStream,
  items: readonly DisplayItem[],
  pageHeight: number,
  addLink: (x: number, y: number, width: number, height: number, url: string) => void,
): void {
  for (const item of items) {
    switch (item.type) {
      case "path": {
        const stroke = item.stroke;
        if (stroke) {
          content.save().strokeColor(stroke.color).lineWidth(stroke.width);
          if (stroke.dash) content.dash(stroke.dash);
          if (stroke.cap) content.lineCap(stroke.cap);
          if (stroke.join) content.lineJoin(stroke.join);
        }
        if (item.fill) content.fillColor(item.fill);
        tracePath(content, item.commands);
        if (item.fill && stroke) content.fillAndStroke();
        else if (stroke) content.stroke();
        else if (item.fill) content.fill();
        else content.endPath();
        if (stroke) content.restore();
        break;
      }
      case "text":
        // The page is drawn with y pointing down; flipping the text matrix stands the glyphs
        // back upright.
        content
          .fillColor(item.color)
          .font(item.font as AnyFont, item.size)
          .beginText()
          .textMatrix(1, 0, 0, -1, item.x, item.y)
          .showGlyphs(item.glyphs, item.text)
          .endText();
        break;
      case "image":
        if (item.clip) {
          content.save().rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height).clip();
        }
        content.image(item.image, item.x, item.y + item.height, item.width, -item.height);
        if (item.clip) content.restore();
        break;
      case "link":
        addLink(item.x, pageHeight - item.y - item.height, item.width, item.height, item.url);
        break;
      case "group":
        content.save();
        if (item.rotate) content.rotate(item.rotate.degrees, item.rotate.cx, item.rotate.cy);
        if (item.opacity !== undefined) content.opacity(item.opacity);
        drawItems(content, item.items, pageHeight, addLink);
        content.restore();
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
  options: { boxes?: boolean } = {},
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
  drawItems(content, page.items, page.height, (x, y, width, height, url) =>
    pdfPage.addLink(x + offset, y + offset, width, height, url),
  );
  if (printed) content.restore();

  if (page.marks) {
    // Marks print on every plate: registration colour is all four process inks at full.
    const gap = bleed + 2 * MM;
    const length = 5 * MM;
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
  }
  pdfPage.end();
}
