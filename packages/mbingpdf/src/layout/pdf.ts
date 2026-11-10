/** The PDF backend: writes a display list to a page of a PDF document. */
import type { AnyFont, ContentStream, PdfDocument } from "../core/index.ts";
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

/** Adds a page to the document and draws the display list on it. */
export function writeDisplayPage(document: PdfDocument, page: DisplayPage): void {
  const pdfPage = document.addPage({ size: [page.width, page.height] });
  const content = pdfPage.content;
  // The display list measures from the top-left corner; PDF measures from the bottom-left.
  content.transform(1, 0, 0, -1, 0, page.height);
  drawItems(content, page.items, page.height, (x, y, width, height, url) =>
    pdfPage.addLink(x, y, width, height, url),
  );
  pdfPage.end();
}
