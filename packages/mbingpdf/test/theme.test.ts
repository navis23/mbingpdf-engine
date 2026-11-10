import { describe, expect, test } from "vitest";
import {
  Box,
  type Child,
  cmyk,
  type DisplayItem,
  Document,
  defineTheme,
  Font,
  Heading,
  layoutDocument,
  Page,
  Span,
  StandardFonts,
  Text,
} from "../src/index.ts";
import { readFont } from "./harness/env.ts";

type TextItem = Extract<DisplayItem, { type: "text" }>;
const texts = (items: readonly DisplayItem[]): TextItem[] =>
  items.filter((item): item is TextItem => item.type === "text");

const inter = new Font(readFont("Inter-Variable"));
const barlow = new Font(readFont("BarlowCondensed-Regular"));
const barlowBold = new Font(readFont("BarlowCondensed-Bold"));
const { Helvetica, HelveticaBold, HelveticaOblique, Courier } = StandardFonts;

const theme = defineTheme({
  fonts: {
    body: { variable: inter, fallback: [StandardFonts.ZapfDingbats] },
    display: { sources: { 400: barlow, 700: barlowBold } },
    plain: { sources: { 400: Helvetica, 700: HelveticaBold, "400i": HelveticaOblique } },
    mono: Courier,
  },
  colors: { text: "#111827", muted: "#6B7280", brand: cmyk(0.9, 0.55, 0, 0.1) },
  text: {
    body: { font: "body", size: 10, leading: 14, color: "text" },
    h1: { font: "display", weight: 700, size: 22, leading: 28, color: "brand" },
    caption: { font: "body", size: 8, color: "muted" },
  },
});

const first = (...children: Child[]): TextItem[] =>
  texts(
    layoutDocument(Document({ theme }, Page({ size: [300, 300], margin: 10 }, ...children)))
      .pages[0]?.items ?? [],
  );

describe("themes", () => {
  test("defineTheme returns the theme as given", () => {
    expect(theme.colors.muted).toBe("#6B7280");
    expect(theme.text.h1.size).toBe(22);
  });

  test("the body style is the document's default text", () => {
    const [item] = first(Text("isi"));
    expect(item).toMatchObject({ size: 10, color: { space: "rgb", r: 0x11 / 255 } });
    // Inter at its default weight is the variable font itself.
    expect(item?.font).toBe(inter);
    const lines = first(Text("satu\ndua"));
    expect((lines[1]?.y ?? 0) - (lines[0]?.y ?? 0)).toBeCloseTo(14);
  });

  test("named styles, with single properties overridden", () => {
    const [caption, heading, tweaked] = first(
      Text({ style: "caption" }, "kecil"),
      Text({ style: "h1" }, "Judul"),
      Text({ style: "h1", size: 30, color: "muted" }, "Besar"),
    );
    expect(caption).toMatchObject({ size: 8, color: { space: "rgb", r: 0x6b / 255 } });
    expect(heading).toMatchObject({ size: 22, font: barlowBold, color: { space: "cmyk", c: 0.9 } });
    expect(tweaked).toMatchObject({
      size: 30,
      font: barlowBold,
      color: { space: "rgb", r: 0x6b / 255 },
    });
  });

  test("a style's leading follows a change of size, like a line height", () => {
    // h1 is 22 on 28; at 44 points the lines are 56 apart.
    const lines = first(Text({ style: "h1", size: 44 }, "satu\ndua"));
    expect((lines[1]?.y ?? 0) - (lines[0]?.y ?? 0)).toBeCloseTo(56);
  });

  test("colours by name anywhere a colour goes", () => {
    const layout = layoutDocument(
      Document(
        { theme },
        Page(
          { size: [300, 300], margin: 10, fill: "muted" },
          Box({ background: "brand", border: { width: 1, color: "text" }, height: 20 }),
        ),
      ),
    );
    const paths = (layout.pages[0]?.items ?? []).filter((item) => item.type === "path");
    expect(paths[0]).toMatchObject({ fill: { space: "rgb", r: 0x6b / 255 } });
    expect(paths[1]).toMatchObject({ fill: { space: "cmyk", c: 0.9 } });
    expect(paths[2]).toMatchObject({ stroke: { color: { space: "rgb", r: 0x11 / 255 } } });
  });

  test("font families give the right font for a weight and slant", () => {
    const [regular, bold, heavy, light, italic, boldItalic] = first(
      Text({ font: "plain" }, "a"),
      Text({ font: "plain", weight: 700 }, "b"),
      Text({ font: "plain", weight: 900 }, "c"),
      Text({ font: "plain", weight: 100 }, "d"),
      Text({ font: "plain", italic: true }, "e"),
      Text({ font: "plain", weight: 700, italic: true }, "f"),
    );
    expect(regular?.font).toBe(Helvetica);
    expect(bold?.font).toBe(HelveticaBold);
    // The nearest weight there is.
    expect(heavy?.font).toBe(HelveticaBold);
    expect(light?.font).toBe(Helvetica);
    expect(italic?.font).toBe(HelveticaOblique);
    // The only italic is regular weight; slant wins over weight.
    expect(boldItalic?.font).toBe(HelveticaOblique);
  });

  test("a variable font is cut to the weight asked for", () => {
    const [semi, bold, tooHeavy] = first(
      Text({ weight: 600 }, "a"),
      Text({ weight: 700 }, "b"),
      Text({ weight: 5000 }, "c"),
    );
    const nameOf = (item: TextItem | undefined): string | undefined =>
      (item?.font as Font | undefined)?.postScriptName;
    expect(nameOf(semi)).toBe("Inter-SemiBold");
    expect(nameOf(bold)).toBe("Inter-Bold");
    expect(nameOf(tooHeavy)).toBe("Inter-Black");
    // Asked for again, it is the same font object, so it is embedded once.
    expect(first(Text({ weight: 700 }, "x"))[0]?.font).toBe(bold?.font);
  });

  test("weight and slant are inherited, and work inside a paragraph", () => {
    const items = first(
      Box(
        { font: "plain", weight: 700 },
        Text("tebal ", Span({ italic: true }, "miring"), Span({ weight: 400 }, " biasa")),
      ),
    );
    expect(items.map((item) => item.font)).toEqual([HelveticaBold, HelveticaOblique, Helvetica]);
  });

  test("a family's fallback fonts are used for characters it lacks", () => {
    const items = first(Text("Lunas ✔"));
    expect(items.map((item) => item.text)).toEqual(["Lunas ", "✔"]);
    expect(items[1]?.font).toBe(StandardFonts.ZapfDingbats);
  });

  test("a single font can stand for a family, and a font object still overrides the theme", () => {
    const [mono, direct, after] = first(
      Text({ font: "mono", weight: 700 }, "a"),
      Text({ font: barlow }, "b"),
      Box({ font: barlow }, Text({ weight: 700 }, "c")),
    );
    expect(mono?.font).toBe(Courier);
    expect(direct?.font).toBe(barlow);
    // With a font given directly there is no family to pick a weight from.
    expect(after?.font).toBe(barlow);
  });

  test("headings take the theme's h1 … h6 styles when it has them", () => {
    const [h1, h2] = first(Heading("Satu"), Heading({ level: 2 }, "Dua"));
    expect(h1).toMatchObject({ size: 22, font: barlowBold });
    // No "h2" in this theme: the default scale applies to the body text.
    expect(h2).toMatchObject({ size: 15, font: inter });
  });

  test("unknown names are reported with the names that exist", () => {
    expect(() => first(Text({ style: "h7" }, "x"))).toThrow(
      'Unknown text style "h7". The theme has: body, h1, caption.',
    );
    expect(() => first(Text({ color: "merah" }, "x"))).toThrow(
      'Unknown colour "merah". The theme has: text, muted, brand.',
    );
    expect(() => first(Text({ font: "serif" }, "x"))).toThrow(
      'Unknown font "serif". The theme has: body, display, plain, mono.',
    );
    const bare = (child: Child) =>
      layoutDocument(Document(Page({ size: [100, 100], margin: 10 }, child)));
    expect(() => bare(Text({ color: "merah" }, "x"))).toThrow(/use a hex colour/);
    expect(() => bare(Text({ style: "h1" }, "x"))).toThrow(/need a theme/);
    expect(() => bare(Text({ font: "body" }, "x"))).toThrow(/need a theme/);
  });

  test("one document definition, many brands", () => {
    const build = (brand: `#${string}`) =>
      layoutDocument(
        Document(
          { theme: defineTheme({ colors: { brand }, text: { body: { size: 9 } } }) },
          Page({ size: [100, 100], margin: 10 }, Text({ color: "brand" }, "merek")),
        ),
      ).pages[0]?.items.find((item) => item.type === "text");
    expect(build("#ff0000")).toMatchObject({ size: 9, color: { r: 1, g: 0, b: 0 } });
    expect(build("#0000ff")).toMatchObject({ size: 9, color: { r: 0, g: 0, b: 1 } });
  });
});
