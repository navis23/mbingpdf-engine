/** The chart kit and text on a canvas. */
import { describe, expect, test } from "vitest";
import {
  BarChart,
  Canvas,
  cmyk,
  Document,
  defineTheme,
  Font,
  inspect,
  LineChart,
  layoutDocument,
  Page,
  PieChart,
  Row,
  render,
  StandardFonts,
} from "../src/index.ts";
import { niceTicks } from "../src/layout/charts.ts";
import type { DisplayItem } from "../src/layout/display.ts";
import { readFont } from "./harness/env.ts";
import { extractText, structureOutline } from "./harness/render.ts";

const inter = new Font(readFont("Inter-Variable"));

/** Everything a one-element document draws, flattened. */
function drawn(element: ReturnType<typeof BarChart>): DisplayItem[] {
  const flat: DisplayItem[] = [];
  const visit = (items: readonly DisplayItem[]): void => {
    for (const item of items) {
      if (item.type === "group" || item.type === "tagged") visit(item.items);
      else flat.push(item);
    }
  };
  visit(
    layoutDocument(Document({ font: inter }, Page({ margin: 0 }, element))).pages[0]?.items ?? [],
  );
  return flat;
}
const texts = (items: readonly DisplayItem[]): string[] =>
  items.flatMap((item) => (item.type === "text" ? [item.text] : []));
const fills = (items: readonly DisplayItem[]): number =>
  items.filter((item) => item.type === "path" && item.fill && !item.stroke).length;

describe("axis ticks", () => {
  test("are round numbers that cover the data", () => {
    expect(niceTicks(0, 30)).toEqual([0, 10, 20, 30]);
    expect(niceTicks(0, 35)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(-8, 42)).toEqual([-10, 0, 10, 20, 30, 40, 50]);
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    // No 0.30000000000000004.
    expect(niceTicks(0, 0.5)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(niceTicks(0, 4_850_000)).toEqual([0, 1e6, 2e6, 3e6, 4e6, 5e6]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe("text on a canvas", () => {
  test("is placed by its alignment and baseline, and can be measured", () => {
    let hello = 0;
    let large = 0;
    const items = drawn(
      Canvas({
        width: 200,
        height: 50,
        draw: (g) => {
          hello = g.measureText("Halo");
          large = g.measureText("Halo", { size: 20 });
          g.text("Halo", 100, 20);
          g.text("Halo", 100, 20, { align: "center" });
          g.text("Halo", 100, 20, { align: "right", size: 20, color: "#B91C1C" });
          g.text("Halo", 100, 20, { baseline: "top" });
          g.text("Halo", 100, 20, { baseline: "middle" });
          g.text("Halo", 100, 20, { baseline: "bottom" });
          g.text("", 0, 0);
        },
      }) as ReturnType<typeof BarChart>,
    );
    expect(hello).toBeGreaterThan(15);
    expect(large).toBeCloseTo(hello * 2, 6);
    const placed = items.flatMap((item) => (item.type === "text" ? [item] : []));
    expect(placed).toHaveLength(6);
    expect(placed[0]).toMatchObject({ x: 100, y: 20, size: 10, text: "Halo" });
    expect(placed[1]?.x).toBeCloseTo(100 - hello / 2, 6);
    expect(placed[2]?.x).toBeCloseTo(100 - large, 6);
    expect(placed[2]).toMatchObject({ size: 20, color: { space: "rgb" } });
    // Top: the baseline is a capital's height below. Middle: half that. Bottom: above.
    const cap = (placed[3]?.y as number) - 20;
    expect(cap).toBeGreaterThan(6);
    expect(cap).toBeLessThan(8);
    expect((placed[4]?.y as number) - 20).toBeCloseTo(cap / 2, 6);
    expect(placed[5]?.y as number).toBeLessThan(20);
  });

  test("takes the font and size of the text around it, or its own", async () => {
    const pdf = await render(
      Document(
        { font: inter, size: 12 },
        Page(
          Canvas({
            width: 200,
            height: 40,
            draw: (g) => {
              g.text("warisan", 0, 15);
              g.text("Helvetica", 0, 35, { font: StandardFonts.Helvetica });
              g.text("naik", 150, 35, { rotate: -90 });
            },
          }),
        ),
      ),
      { compress: false },
    );
    expect((await extractText(pdf))[0]).toEqual(["warisan", "Helvetica", "naik"]);
    const plain = new TextDecoder("latin1").decode(pdf);
    expect(plain).toContain("/BaseFont/Helvetica");
    expect(plain).toMatch(/\/F1 12 Tf/);
  });
});

describe("charts", () => {
  const labels = ["Jan", "Feb", "Mar"];

  test("a bar chart draws a bar per value, with labels, ticks and a title", () => {
    const items = drawn(BarChart({ labels, values: [12, 19, 7], title: "Pesanan", width: 300 }));
    expect(texts(items)).toEqual(["Pesanan", "0", "5", "10", "15", "20", "Jan", "Feb", "Mar"]);
    expect(fills(items)).toBe(3);
    // Value labels are opt-in, and formatted like the ticks.
    const labelled = drawn(
      BarChart({ labels, values: [12, 19, 7], valueLabels: true, format: (v) => `${v} unit` }),
    );
    expect(texts(labelled)).toEqual(expect.arrayContaining(["12 unit", "19 unit", "20 unit"]));
  });

  test("several series get a legend; stacking adds them up", () => {
    const series = [
      { name: "Bus", values: [10, 20, 30] },
      { name: "Minibus", values: [5, null, 25] },
    ];
    const grouped = drawn(BarChart({ labels, series }));
    // Five bars (one value is missing) and two legend swatches.
    expect(fills(grouped)).toBe(5 + 2);
    expect(texts(grouped)).toEqual(expect.arrayContaining(["Bus", "Minibus", "30"]));
    expect(texts(grouped)).not.toContain("60");
    const stacked = drawn(BarChart({ labels, series, stacked: true }));
    expect(texts(stacked)).toContain("60");
    expect(texts(drawn(BarChart({ labels, series, legend: false })))).not.toContain("Bus");
  });

  test("the value axis follows the data, or what it is told", () => {
    expect(texts(drawn(BarChart({ labels, values: [5, -8, 3] })))).toEqual(
      expect.arrayContaining(["-10", "-5", "0", "5"]),
    );
    const fixed = texts(drawn(BarChart({ labels, values: [5, 8, 3], min: 0, max: 100 })));
    expect(fixed).toEqual(expect.arrayContaining(["0", "20", "100"]));
    // Horizontal: the labels run down the side, the values along the bottom.
    const side = drawn(BarChart({ labels, values: [5, 8, 3], horizontal: true }));
    const jan = side.find((item) => item.type === "text" && item.text === "Jan");
    const feb = side.find((item) => item.type === "text" && item.text === "Feb");
    expect((feb as { y: number }).y).toBeGreaterThan((jan as { y: number }).y);
  });

  test("labels that would overlap are thinned out", () => {
    const many = Array.from({ length: 40 }, (_label, i) => `Minggu ${i + 1}`);
    const items = drawn(BarChart({ labels: many, values: many.map((_label, i) => i), width: 300 }));
    const shown = texts(items).filter((text) => text.startsWith("Minggu"));
    expect(shown.length).toBeLessThan(12);
    expect(shown[0]).toBe("Minggu 1");
  });

  test("a line chart draws a line per series and breaks at gaps", () => {
    const items = drawn(
      LineChart({
        labels: ["a", "b", "c", "d", "e"],
        series: [
          { name: "satu", values: [1, 2, 3, 4, 5] },
          { name: "dua", values: [2, 3, null, 1, 2] },
        ],
      }),
    );
    const lines = items.filter(
      (item) => item.type === "path" && item.stroke?.width === 1.5 && !item.fill,
    );
    // One for the first series, two for the second, which has a hole.
    expect(lines).toHaveLength(3);
    const smooth = drawn(
      LineChart({ labels, values: [1, 5, 2], smooth: true, area: true, points: false }),
    );
    const curve = smooth.find((item) => item.type === "path" && item.stroke?.width === 1.5);
    expect(
      (curve as Extract<DisplayItem, { type: "path" }>).commands.map((command) => command[0]),
    ).toEqual(["M", "C", "C"]);
    // The area under it is filled in a pale version of the line's colour.
    const area = smooth.find(
      (item) => item.type === "path" && item.fill && item.commands.at(-1)?.[0] === "Z",
    ) as Extract<DisplayItem, { type: "path" }>;
    expect(area.fill).toMatchObject({ space: "rgb" });
    expect((area.fill as { b: number }).b).toBeGreaterThan(0.9);
  });

  test("a pie chart draws a slice per value and writes the shares", () => {
    const data = [
      { label: "Bus", value: 50 },
      { label: "Minibus", value: 30 },
      { label: "Sedan", value: 20 },
      { label: "Kosong", value: 0 },
    ];
    const items = drawn(PieChart({ data, width: 200 }));
    expect(texts(items)).toEqual(
      expect.arrayContaining(["50%", "30%", "20%", "Bus", "Minibus", "Sedan", "Kosong"]),
    );
    const slices = items.filter((item) => item.type === "path" && item.fill && item.stroke);
    expect(slices).toHaveLength(3);
    const values = texts(drawn(PieChart({ data, valueLabels: "value", donut: true })));
    expect(values).toEqual(expect.arrayContaining(["50", "30", "20"]));
    expect(texts(drawn(PieChart({ data, valueLabels: false, legend: false })))).toEqual([]);
    expect(() => PieChart({ data: [{ label: "x", value: -1 }] })).toThrow(
      'A pie slice cannot be negative: "x" is -1',
    );
    // Nothing to divide: no slices, no error.
    expect(fills(drawn(PieChart({ data: [{ label: "x", value: 0 }], legend: false })))).toBe(0);
  });

  test("colours come from the palette, the series, or the theme", () => {
    const theme = defineTheme({ colors: { brand: "#FF0000" } });
    const document = Document(
      { font: inter, theme },
      Page(
        BarChart({
          labels: ["a"],
          series: [
            { values: [1], color: "brand" },
            { values: [2], color: cmyk(1, 0, 0, 0) },
            { values: [3] },
          ],
          colors: ["#00FF00"],
        }),
      ),
    );
    const colours = (layoutDocument(document).pages[0]?.items ?? []).flatMap((item) =>
      item.type === "path" && item.fill && !item.stroke ? [item.fill] : [],
    );
    expect(colours).toEqual([
      { space: "rgb", r: 1, g: 0, b: 0 },
      { space: "cmyk", c: 1, m: 0, y: 0, k: 0 },
      { space: "rgb", r: 0, g: 1, b: 0 },
    ]);
  });

  test("a chart is laid out like any element and is a figure in a tagged file", async () => {
    const document = Document(
      { font: inter },
      Page(
        { margin: 50 },
        Row(
          { gap: 10 },
          BarChart({ grow: 1, basis: 0, labels, values: [1, 2, 3], title: "Kiri" }),
          PieChart({ grow: 1, basis: 0, height: 120, data: [{ label: "a", value: 1 }] }),
        ),
        LineChart({ labels, values: [1, 2, 3], alt: "Penjualan naik dari Januari ke Maret" }),
      ),
    );
    const boxes = inspect(document)[0]?.boxes[0]?.children ?? [];
    const row = boxes[0]?.children ?? [];
    expect(row[0]).toMatchObject({ type: "Canvas", height: 180 });
    expect(row[1]).toMatchObject({ type: "Canvas", height: 120 });
    expect(row[0]?.width).toBeCloseTo(row[1]?.width as number, 6);
    // Without a width a chart fills its container.
    expect(boxes[1]?.width).toBeCloseTo(595.276 - 100, 2);
    const outline = (await structureOutline(await render(document, { tagged: true })))[0] ?? [];
    expect(outline.map((line) => line.replace(/:.*$/, ""))).toEqual([
      "Document",
      "  Figure [Bar chart",
      "  Figure [Pie chart]",
      "  Figure [Penjualan naik dari Januari ke Maret]",
    ]);
  });

  test("a chart with nothing to show says so", () => {
    expect(() => BarChart({ labels })).toThrow("A chart needs `series` or `values`");
  });
});
