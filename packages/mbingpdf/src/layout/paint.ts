/** Painting: turns laid-out boxes into the display list of a page. */
import type { Color, PositionedGlyph } from "../core/index.ts";
import type { TextFont } from "../text/index.ts";
import { CanvasContext, roundedRectPath } from "./canvas.ts";
import type { DisplayItem, PathCommand } from "./display.ts";
import type { Box } from "./engine.ts";
import type { ResolvedSide } from "./style.ts";

const rectPath = (x: number, y: number, width: number, height: number): PathCommand[] => [
  ["R", x, y, width, height],
];

function sameSide(a: ResolvedSide | undefined, b: ResolvedSide | undefined): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    a.width === b.width &&
    JSON.stringify(a.color) === JSON.stringify(b.color) &&
    JSON.stringify(a.dash) === JSON.stringify(b.dash)
  );
}

/** Moves display items by an offset. */
export function shiftItems(items: readonly DisplayItem[], dx: number, dy: number): DisplayItem[] {
  if (dx === 0 && dy === 0) return [...items];
  return items.map((item): DisplayItem => {
    switch (item.type) {
      case "path":
        return {
          ...item,
          commands: item.commands.map((command) => {
            if (command[0] === "Z") return command;
            if (command[0] === "R")
              return ["R", command[1] + dx, command[2] + dy, command[3], command[4]];
            const moved: (string | number)[] = [command[0]];
            for (let i = 1; i < command.length; i += 2) {
              moved.push((command[i] as number) + dx, (command[i + 1] as number) + dy);
            }
            return moved as unknown as (typeof item.commands)[number];
          }),
        };
      case "shared":
        return {
          ...item,
          x: item.x + dx,
          y: item.y + dy,
          ...(item.clip
            ? { clip: { ...item.clip, x: item.clip.x + dx, y: item.clip.y + dy } }
            : {}),
        };
      case "tagged":
        return { ...item, items: shiftItems(item.items, dx, dy) };
      case "group":
        return {
          ...item,
          ...(item.rotate
            ? { rotate: { ...item.rotate, cx: item.rotate.cx + dx, cy: item.rotate.cy + dy } }
            : {}),
          items: shiftItems(item.items, dx, dy),
        };
      case "image":
        return {
          ...item,
          x: item.x + dx,
          y: item.y + dy,
          ...(item.clip
            ? { clip: { ...item.clip, x: item.clip.x + dx, y: item.clip.y + dy } }
            : {}),
        };
      default:
        return { ...item, x: item.x + dx, y: item.y + dy };
    }
  });
}

const spaces: WeakMap<TextFont, PositionedGlyph | undefined> = new WeakMap();

/** The glyph a font uses for a space, if it has one. */
function spaceOf(font: TextFont): PositionedGlyph | undefined {
  if (!spaces.has(font)) {
    const glyph = font.shape?.(" ")[0];
    spaces.set(font, glyph && glyph.id !== 0 ? glyph : undefined);
  }
  return spaces.get(font);
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
  if (box.tags) {
    for (const tag of box.tags) {
      const inside: DisplayItem[] = [];
      target.push({ type: "tagged", tag, items: inside });
      target = inside;
    }
  }
  const tagged = box.tags !== undefined;
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
        stroke: { color: top.color, width: top.width, ...(top.dash ? { dash: top.dash } : {}) },
      });
    } else {
      // One side: a filled strip, or for a dashed side a line down the strip's middle.
      const side = (
        line: ResolvedSide,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        across: boolean,
      ): void => {
        if (!line.dash) {
          target.push({ type: "path", commands: rectPath(sx, sy, sw, sh), fill: line.color });
          return;
        }
        target.push({
          type: "path",
          commands: across
            ? [
                ["M", sx, sy + sh / 2],
                ["L", sx + sw, sy + sh / 2],
              ]
            : [
                ["M", sx + sw / 2, sy],
                ["L", sx + sw / 2, sy + sh],
              ],
          stroke: { color: line.color, width: line.width, dash: line.dash },
        });
      };
      if (top) side(top, x, y, width, top.width, true);
      if (bottom) side(bottom, x, y + height - bottom.width, width, bottom.width, true);
      if (left) side(left, x, y, left.width, height, false);
      if (right) side(right, x + width - right.width, y, right.width, height, false);
    }
  }

  if (box.text) {
    const paragraph = target;
    // In a tagged document the pieces of one link, which may run over lines, form one element.
    let link: { to: string; items: DisplayItem[] } | undefined;
    for (const line of box.text.lines) {
      const baseline = y + box.text.y + line.baseline;
      for (const run of line.runs) {
        const runX = x + box.text.x + run.x;
        const color = run.style.color as Color;
        const to = run.style.link ?? run.style.linkTo;
        if (!tagged || to === undefined) {
          target = paragraph;
          link = undefined;
        } else {
          if (link?.to !== to) {
            link = { to, items: [] };
            paragraph.push({ type: "tagged", tag: { role: "Link" }, items: link.items });
          }
          target = link.items;
        }
        if (run.glyphs.length > 0) {
          // The space a line was broken at is not drawn. A reader that takes the text from
          // the structure needs it back, or the words either side of the break run together.
          const spaced =
            tagged && run === line.runs.at(-1) && !line.hyphenated && !/\s$/.test(run.text)
              ? spaceOf(run.font)
              : undefined;
          // A hyphen the layout added at a line break is no part of the text: it stands for a
          // soft hyphen (ISO 32000-1, 14.8.2.2.3), so copied or read text has the word whole.
          const text =
            line.hyphenated && run === line.runs.at(-1) && run.text.endsWith("-")
              ? `${run.text.slice(0, -1)}\u00ad`
              : run.text;
          const tracked = (run.style.letterSpacing ?? 0) > 0;
          target.push({
            type: "text",
            x: runX,
            y: baseline,
            font: run.font,
            size: run.size,
            color,
            glyphs:
              spaced && !tracked
                ? [...run.glyphs, { ...spaced, cluster: run.text.length }]
                : run.glyphs,
            text: spaced && !tracked ? `${text} ` : text,
            ...(tracked ? { letterSpacing: run.style.letterSpacing as number } : {}),
          });
          // Letter-spaced text is written with its words spelled out for readers; the space
          // of the line break is no part of those words, so it follows on its own.
          if (spaced && tracked) {
            target.push({
              type: "text",
              x: runX + run.width,
              y: baseline,
              font: run.font,
              size: run.size,
              color,
              glyphs: [{ ...spaced, cluster: 0 }],
              text: " ",
            });
          }
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
    target = paragraph;
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
    canvas.draw(
      new CanvasContext(drawn, canvas.color, { fonts: canvas.fonts, size: canvas.size }),
      {
        width: canvas.width,
        height: canvas.height,
      },
    );
    target.push(...shiftItems(drawn, x + canvas.x, y + canvas.y));
  }

  if (box.vector) {
    const vector = box.vector;
    target.push({
      type: "shared",
      items: vector.items,
      width: vector.width,
      height: vector.height,
      x: x + vector.x,
      y: y + vector.y,
      scale: vector.scale,
      ...(vector.clip
        ? {
            clip: {
              x: x + vector.clip.x,
              y: y + vector.clip.y,
              width: vector.clip.width,
              height: vector.clip.height,
            },
          }
        : {}),
    });
  }

  for (const child of box.children) paintBox(child, x, y, target);
}
