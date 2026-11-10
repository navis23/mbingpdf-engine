/** Painting: turns laid-out boxes into the display list of a page. */
import type { Color } from "../core/index.ts";
import type { TextFont } from "../text/index.ts";
import { CanvasContext, roundedRectPath } from "./canvas.ts";
import type { DisplayItem, PathCommand } from "./display.ts";
import type { Box } from "./engine.ts";

const rectPath = (x: number, y: number, width: number, height: number): PathCommand[] => [
  ["R", x, y, width, height],
];

function sameSide(
  a: { width: number; color: Color } | undefined,
  b: { width: number; color: Color } | undefined,
): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    a.width === b.width &&
    JSON.stringify(a.color) === JSON.stringify(b.color)
  );
}

/** Shifts every coordinate a canvas callback records, so it draws where its box is. */
function translate(items: DisplayItem[], dx: number, dy: number): DisplayItem[] {
  return items.map((item) => {
    if (item.type !== "path") return item;
    return {
      ...item,
      commands: item.commands.map((command) => {
        if (command[0] === "Z") return command;
        if (command[0] === "R")
          return ["R", command[1] + dx, command[2] + dy, command[3], command[4]];
        const shifted: (string | number)[] = [command[0]];
        for (let i = 1; i < command.length; i += 2) {
          shifted.push((command[i] as number) + dx, (command[i + 1] as number) + dy);
        }
        return shifted as unknown as PathCommand;
      }),
    };
  });
}

/**
 * Adds everything a box and its children draw to `items`.
 *
 * @param originX left edge of the parent box on the page
 * @param originY top edge of the parent box on the page
 */
export function paintBox(box: Box, originX: number, originY: number, items: DisplayItem[]): void {
  const x = box.page ? box.x : originX + box.x;
  const y = box.page ? box.y : originY + box.y;
  const { width, height } = box;

  let target = items;
  if (box.opacity !== undefined || box.rotate) {
    const group: DisplayItem[] = [];
    items.push({
      type: "group",
      ...(box.opacity !== undefined ? { opacity: box.opacity } : {}),
      ...(box.rotate
        ? { rotate: { degrees: box.rotate, cx: x + width / 2, cy: y + height / 2 } }
        : {}),
      items: group,
    });
    target = group;
  }

  if (box.id !== undefined) target.push({ type: "anchor", id: box.id, x, y });
  if (box.heading) {
    target.push({
      type: "heading",
      level: box.heading.level,
      title: box.heading.title,
      id: box.id ?? "",
      x,
      y,
    });
  }
  if (box.background && width > 0 && height > 0) {
    target.push({
      type: "path",
      commands: box.radius
        ? roundedRectPath(x, y, width, height, box.radius)
        : rectPath(x, y, width, height),
      fill: box.background,
    });
  }

  const border = box.border;
  if (border) {
    const { top, right, bottom, left } = border;
    if (top && sameSide(top, right) && sameSide(top, bottom) && sameSide(top, left)) {
      // A uniform border is one stroked outline, which also follows rounded corners.
      const inset = top.width / 2;
      target.push({
        type: "path",
        commands: roundedRectPath(
          x + inset,
          y + inset,
          width - top.width,
          height - top.width,
          Math.max(0, (box.radius ?? 0) - inset),
        ),
        stroke: { color: top.color, width: top.width },
      });
    } else {
      if (top)
        target.push({ type: "path", commands: rectPath(x, y, width, top.width), fill: top.color });
      if (bottom) {
        target.push({
          type: "path",
          commands: rectPath(x, y + height - bottom.width, width, bottom.width),
          fill: bottom.color,
        });
      }
      if (left)
        target.push({
          type: "path",
          commands: rectPath(x, y, left.width, height),
          fill: left.color,
        });
      if (right) {
        target.push({
          type: "path",
          commands: rectPath(x + width - right.width, y, right.width, height),
          fill: right.color,
        });
      }
    }
  }

  if (box.text) {
    for (const line of box.text.lines) {
      const baseline = y + box.text.y + line.baseline;
      for (const run of line.runs) {
        const runX = x + box.text.x + run.x;
        const color = run.style.color as Color;
        if (run.glyphs.length > 0) {
          target.push({
            type: "text",
            x: runX,
            y: baseline,
            font: run.font,
            size: run.size,
            color,
            glyphs: run.glyphs,
            text: run.text,
          });
        }
        // Underline and strike-through follow the font's own metrics where it has them.
        const metrics = run.font as TextFont & {
          underlinePosition?: number;
          underlineThickness?: number;
          xHeight?: number;
        };
        const scale = run.size / run.font.unitsPerEm;
        const thickness = Math.max((metrics.underlineThickness ?? 50) * scale, 0.4);
        if (run.style.underline || run.style.link !== undefined) {
          const offset = -(metrics.underlinePosition ?? -100) * scale;
          target.push({
            type: "path",
            commands: rectPath(runX, baseline + offset - thickness / 2, run.width, thickness),
            fill: color,
          });
        }
        if (run.style.strikethrough) {
          const offset = ((metrics.xHeight ?? 500) * scale) / 2;
          target.push({
            type: "path",
            commands: rectPath(runX, baseline - offset - thickness / 2, run.width, thickness),
            fill: color,
          });
        }
        if (run.style.link !== undefined || run.style.linkTo !== undefined) {
          target.push({
            type: "link",
            x: runX,
            y: y + box.text.y + line.top,
            width: run.width,
            height: line.height,
            ...(run.style.link !== undefined
              ? { url: run.style.link }
              : { target: run.style.linkTo as string }),
          });
        }
      }
    }
  }

  if (box.image) {
    const image = box.image;
    target.push({
      type: "image",
      x: x + image.x,
      y: y + image.y,
      width: image.width,
      height: image.height,
      image: image.image,
      ...(image.clip ? { clip: { x, y, width, height } } : {}),
    });
  }

  if (box.canvas) {
    const canvas = box.canvas;
    const drawn: DisplayItem[] = [];
    canvas.draw(new CanvasContext(drawn, canvas.color), {
      width: canvas.width,
      height: canvas.height,
    });
    target.push(...translate(drawn, x + canvas.x, y + canvas.y));
  }

  for (const child of box.children) paintBox(child, x, y, target);
}
