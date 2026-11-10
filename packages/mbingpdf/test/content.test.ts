import { describe, expect, test } from "vitest";
import {
  ContentStream,
  cmyk,
  gray,
  hex,
  mm,
  PageSizes,
  PdfDocument,
  printBoxes,
  rgb,
} from "../src/core/index.ts";

const text = (content: ContentStream): string => new TextDecoder().decode(content.toBytes());
const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

describe("ContentStream", () => {
  test("paths and painting", () => {
    const c = new ContentStream()
      .moveTo(10, 20)
      .lineTo(30.5, 40.25)
      .curveTo(1, 2, 3, 4, 5, 6)
      .closePath()
      .stroke()
      .rect(0, 0, 100, 50)
      .fill()
      .rect(0, 0, 1, 1)
      .fill("evenodd")
      .rect(0, 0, 1, 1)
      .fillAndStroke()
      .rect(0, 0, 1, 1)
      .fillAndStroke("evenodd")
      .rect(0, 0, 1, 1)
      .endPath();
    expect(text(c)).toBe(
      "10 20 m\n30.5 40.25 l\n1 2 3 4 5 6 c\nh\nS\n0 0 100 50 re\nf\n0 0 1 1 re\nf*\n" +
        "0 0 1 1 re\nB\n0 0 1 1 re\nB*\n0 0 1 1 re\nn\n",
    );
  });

  test("colours in gray, RGB and CMYK", () => {
    const c = new ContentStream()
      .fillColor(gray(0.5))
      .strokeColor(gray(0))
      .fillColor(rgb(1, 0.5, 0))
      .strokeColor(hex("#3366cc"))
      .fillColor(cmyk(0, 1, 1, 0.1))
      .strokeColor(cmyk(1, 0, 0, 0));
    expect(text(c)).toBe("0.5 g\n0 G\n1 0.5 0 rg\n0.2 0.4 0.8 RG\n0 1 1 0.1 k\n1 0 0 0 K\n");
  });

  test("colour helpers validate their input", () => {
    expect(() => rgb(1.2, 0, 0)).toThrow(RangeError);
    expect(() => cmyk(0, 0, 0, -1)).toThrow(RangeError);
    expect(() => gray(Number.NaN)).toThrow(RangeError);
    expect(() => hex("#12345")).toThrow(RangeError);
    expect(hex("fff")).toEqual(rgb(1, 1, 1));
  });

  test("line style", () => {
    const c = new ContentStream()
      .lineWidth(0.5)
      .lineCap("round")
      .lineJoin("bevel")
      .miterLimit(4)
      .dash([3, 1.5], 2)
      .dash([]);
    expect(text(c)).toBe("0.5 w\n1 J\n2 j\n4 M\n[3 1.5] 2 d\n[] 0 d\n");
    expect(() => new ContentStream().lineWidth(-1)).toThrow(RangeError);
    expect(() => new ContentStream().dash([0, 0])).toThrow(RangeError);
    expect(() => new ContentStream().dash([-1])).toThrow(RangeError);
  });

  test("transforms", () => {
    const c = new ContentStream()
      .save()
      .translate(10, 20)
      .scale(2)
      .scale(2, 0.5)
      .rotate(90)
      .rotate(180, 50, 50)
      .restore();
    expect(text(c)).toBe(
      "q\n1 0 0 1 10 20 cm\n2 0 0 2 0 0 cm\n2 0 0 0.5 0 0 cm\n0 1 -1 0 0 0 cm\n" +
        "-1 0 0 -1 100 100 cm\nQ\n",
    );
  });

  test("small scale factors keep their precision", () => {
    expect(text(new ContentStream().scale(0.00125))).toBe("0.00125 0 0 0.00125 0 0 cm\n");
  });

  test("clipping", () => {
    const c = new ContentStream().group((g) => g.rect(0, 0, 10, 10).clip().circle(5, 5, 1).fill());
    const out = text(c);
    expect(out.startsWith("q\n0 0 10 10 re\nW\nn\n6 5 m\n")).toBe(true);
    expect(out.endsWith("h\nf\nQ\n")).toBe(true);
    expect(text(new ContentStream().rect(0, 0, 1, 1).clip("evenodd"))).toBe("0 0 1 1 re\nW*\nn\n");
  });

  test("shapes", () => {
    expect(text(new ContentStream().roundedRect(0, 0, 10, 10, 0))).toBe("0 0 10 10 re\n");
    const rounded = text(new ContentStream().roundedRect(0, 0, 100, 40, 500));
    expect(rounded.startsWith("20 0 m\n80 0 l\n")).toBe(true);
    expect(rounded.match(/ c\n/g)?.length).toBe(4);
    const ellipse = text(new ContentStream().ellipse(50, 50, 20, 10));
    expect(ellipse.startsWith("70 50 m\n70 55.523 61.046 60 50 60 c\n")).toBe(true);
    expect(text(new ContentStream().quadraticCurveTo(0, 0, 30, 30, 60, 0))).toBe(
      "20 20 40 20 60 0 c\n",
    );
  });

  test("save and restore must balance", () => {
    expect(() => new ContentStream().restore()).toThrow(/without a matching save/);
    expect(() => new ContentStream().save().toBytes()).toThrow(/without a matching restore/);
  });

  test("rejects numbers PDF cannot hold", () => {
    expect(() => new ContentStream().moveTo(Number.NaN, 0)).toThrow(RangeError);
  });

  test("opacity needs a page", () => {
    expect(() => new ContentStream().opacity(0.5)).toThrow(/belongs to a page/);
    expect(() => new ContentStream().opacity(2)).toThrow(RangeError);
  });

  test("raw operators are passed through", () => {
    expect(text(new ContentStream().raw("BT ET").raw("q Q\n"))).toBe("BT ET\nq Q\n");
  });
});

describe("pages", () => {
  const plain = { xref: "table", compress: false, deterministic: true } as const;

  test("opacity states are shared between pages and listed in their resources", () => {
    const doc = new PdfDocument(plain);
    doc.addPage({ size: PageSizes.A4 }).content.opacity(0.5).opacity({ fill: 0.25 });
    doc.addPage({ size: PageSizes.A4 }).content.opacity(0.5);
    doc.addPage({ size: PageSizes.A4 });
    const out = latin1(doc.finish());
    expect(out.match(/\/Type\/ExtGState/g)?.length).toBe(2);
    expect(out).toContain("<</Type/ExtGState/ca 0.5/CA 0.5>>");
    expect(out).toContain("<</Type/ExtGState/ca 0.25>>");
    expect(out).toMatch(/\/Resources<<\/ExtGState<<\/GS1 \d+ 0 R\/GS2 \d+ 0 R>>>>/);
    expect(out).toMatch(/\/Resources<<\/ExtGState<<\/GS1 \d+ 0 R>>>>/);
    expect(out).toContain("/GS1 gs\n/GS2 gs\n");
    expect(out).toContain("/Resources<<>>>>");
  });

  test("print boxes", () => {
    const boxes = printBoxes([mm(100), mm(50)], mm(3), mm(5));
    const round = (values: readonly number[]): number[] =>
      values.map((v) => Math.round(v * 1000) / 1000);
    expect(round(boxes.size)).toEqual(round([mm(116), mm(66)]));
    expect(round(boxes.bleedBox)).toEqual(round([mm(5), mm(5), mm(111), mm(61)]));
    expect(round(boxes.trimBox)).toEqual(round([mm(8), mm(8), mm(108), mm(58)]));

    const doc = new PdfDocument(plain);
    doc.addPage(printBoxes([200, 100], 10));
    const out = latin1(doc.finish());
    expect(out).toContain("/MediaBox[0 0 220 120]/BleedBox[0 0 220 120]/TrimBox[10 10 210 110]");
  });

  test("page boxes are validated", () => {
    const doc = new PdfDocument(plain);
    expect(() => doc.addPage({ size: [100, 100], trimBox: [10, 10, 120, 90] })).toThrow(RangeError);
    expect(() => doc.addPage({ size: [100, 100], bleedBox: [-1, 0, 100, 100] })).toThrow(
      RangeError,
    );
    expect(() =>
      doc.addPage({ size: [100, 100], bleedBox: [10, 10, 90, 90], trimBox: [5, 5, 95, 95] }),
    ).toThrow(RangeError);
    expect(() => doc.addPage({ size: [100, 100], trimBox: [50, 50, 50, 60] })).toThrow(RangeError);
    expect(() => doc.addPage({ size: [0, 100] })).toThrow(RangeError);
  });

  test("a page cannot be drawn on after it is written", () => {
    const doc = new PdfDocument(plain);
    const page = doc.addPage({ size: [100, 100] });
    page.end();
    page.end();
    expect(() => page.content).toThrow(/already written/);
  });

  test("pages keep their order when ended out of order", () => {
    const doc = new PdfDocument(plain);
    const first = doc.addPage({ size: [100, 100] });
    const second = doc.addPage({ size: [200, 200] });
    second.end();
    first.end();
    expect(latin1(doc.finish())).toContain(`/Kids[${first.ref.num} 0 R ${second.ref.num} 0 R]`);
  });
  test("a form is written once and placed on any page", () => {
    const doc = new PdfDocument(plain);
    const form = doc.createForm([0, 0, 40, 20]);
    form.content
      .fillColor(rgb(1, 0, 0))
      .rect(0, 0, 40, 20)
      .fill()
      .opacity(0.5);
    const first = doc.addPage({ size: [100, 100] });
    first.content.save().transform(2, 0, 0, 2, 10, 10).form(form).restore();
    // A form may be placed before it is finished, and again after.
    form.end();
    form.end();
    expect(() => form.content).toThrow(/already written/);
    const second = doc.addPage({ size: [100, 100] });
    second.content.form(form);
    const out = latin1(doc.finish());
    expect(out.match(/\/Subtype\/Form/g)).toHaveLength(1);
    expect(out).toMatch(
      /\/Type\/XObject\/Subtype\/Form\/BBox\[0 0 40 20\]\/Resources<<\/ExtGState<<\/GS1 \d+ 0 R>>>>/,
    );
    expect(out).toContain("q\n2 0 0 2 10 10 cm\n/Fm1 Do\nQ");
    expect(out.match(/\/XObject<<\/Fm1 \d+ 0 R>>/g)).toHaveLength(2);
    expect(() => doc.createForm([0, 0, 0, 10])).toThrow(RangeError);
    expect(() => new ContentStream().form(form)).toThrow(/belongs to a page/);
  });
});
