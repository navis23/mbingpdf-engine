import * as hb from "harfbuzzjs";
import { describe, expect, test } from "vitest";
import { Font } from "../src/font/index.ts";
import { readFont } from "./harness/env.ts";
import { ALL_FONT_FILES, type FontFile } from "./harness/samples.ts";

type Command = [string, ...number[]];

/** Parses an SVG path as HarfBuzz writes it: "M10,20L30,40Q…Z". */
function parse(path: string): Command[] {
  return [...path.matchAll(/([MLQCZ])([^MLQCZ]*)/g)].map((match) => [
    match[1] as string,
    ...((match[2] ?? "").match(/-?\d+(\.\d+)?/g) ?? []).map(Number),
  ]);
}

/**
 * What a path encloses, independent of where each contour starts and of whether the closing
 * line is written out: the signed area, the box around all points, and the contour count.
 */
function geometry(commands: readonly (readonly [string, ...number[]])[]): {
  area: number;
  box: [number, number, number, number];
  contours: number;
} {
  const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - bx * ay;
  let area = 0;
  let contours = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const see = (px: number, py: number): void => {
    box[0] = Math.min(box[0], px);
    box[1] = Math.min(box[1], py);
    box[2] = Math.max(box[2], px);
    box[3] = Math.max(box[3], py);
  };
  for (const command of commands) {
    const n = command.slice(1) as number[];
    if (command[0] === "M") {
      [x, y] = n as [number, number];
      startX = x;
      startY = y;
      contours++;
      see(x, y);
    } else if (command[0] === "L") {
      const [x1, y1] = n as [number, number];
      area += cross(x, y, x1, y1) / 2;
      x = x1;
      y = y1;
      see(x, y);
    } else if (command[0] === "Q") {
      const [x1, y1, x2, y2] = n as [number, number, number, number];
      area += (2 * cross(x, y, x1, y1) + cross(x, y, x2, y2) + 2 * cross(x1, y1, x2, y2)) / 6;
      see(x1, y1);
      x = x2;
      y = y2;
      see(x, y);
    } else if (command[0] === "C") {
      const [x1, y1, x2, y2, x3, y3] = n as [number, number, number, number, number, number];
      area +=
        (6 * cross(x, y, x1, y1) +
          3 * cross(x, y, x2, y2) +
          cross(x, y, x3, y3) +
          3 * cross(x1, y1, x2, y2) +
          3 * cross(x1, y1, x3, y3) +
          6 * cross(x2, y2, x3, y3)) /
        20;
      see(x1, y1);
      see(x2, y2);
      x = x3;
      y = y3;
      see(x, y);
    } else {
      area += cross(x, y, startX, startY) / 2;
      x = startX;
      y = startY;
    }
  }
  return { area, box, contours };
}

function compare(file: FontFile, font: Font, reference: hb.Font, tolerance: number): void {
  for (let glyph = 0; glyph < font.numGlyphs; glyph++) {
    const want = geometry(parse(reference.glyphToPath(glyph)));
    const got = geometry(font.glyphOutline(glyph) as unknown as Command[]);
    expect(got.contours, `${file} glyph ${glyph} contours`).toBe(want.contours);
    if (want.contours === 0) continue;
    for (let i = 0; i < 4; i++) {
      expect(
        Math.abs((got.box[i] as number) - (want.box[i] as number)),
        `${file} glyph ${glyph} box`,
      ).toBeLessThanOrEqual(tolerance);
    }
    // The area may differ by the rounding of each point, which grows with the outline's size.
    const size = want.box[2] - want.box[0] + (want.box[3] - want.box[1]);
    expect(Math.abs(got.area - want.area), `${file} glyph ${glyph} area`).toBeLessThanOrEqual(
      tolerance * size * 4 + 1e-6,
    );
  }
}

describe("glyph outlines", () => {
  test.each(ALL_FONT_FILES)("every glyph has the outline HarfBuzz reports: %s", (file) => {
    const bytes = readFont(file);
    compare(
      file,
      new Font(bytes),
      new hb.Font(new hb.Face(new hb.Blob(bytes.slice().buffer))),
      0.01,
    );
  });

  test("an instance of a variable font has the instance's outlines", () => {
    const bytes = readFont("PlusJakartaSans-Variable");
    const reference = new hb.Font(new hb.Face(new hb.Blob(bytes.slice().buffer)));
    reference.setVariations([new hb.Variation("wght", 800)]);
    // An instance stores whole numbers; HarfBuzz reports the unrounded shape.
    compare("PlusJakartaSans-Variable", new Font(bytes).instance({ wght: 800 }), reference, 1.01);
  });

  test("a glyph without ink, and one that does not exist, have empty outlines", () => {
    const font = new Font(readFont("BarlowCondensed-Regular"));
    expect(font.glyphOutline(font.glyphForCodePoint(0x20))).toEqual([]);
    expect(font.glyphOutline(99_999)).toEqual([]);
  });
});
