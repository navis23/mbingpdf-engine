import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PdfDocument } from "../src/core/index.ts";
import {
  Absolute,
  Box,
  cmyk,
  Document,
  Font,
  Image,
  layoutDocument,
  mm,
  Page,
  render,
  StandardFonts,
  spot,
  Text,
} from "../src/index.ts";
import { renderSvg } from "../src/svg/index.ts";
import { env, readFont } from "./harness/env.ts";
import { renderPdf } from "./harness/render.ts";

const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
const inter = new Font(readFont("Inter-Variable"));
const intent = { profile: env.icc, identifier: "CGATS TR 001" };
const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;

function qpdfCheck(pdf: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "mbingpdf-"));
  try {
    const file = join(dir, "out.pdf");
    writeFileSync(file, pdf);
    const result = spawnSync("qpdf", ["--check", file], { encoding: "utf8" });
    return result.stdout + result.stderr;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("bleed and printer's marks", () => {
  test("a bleed enlarges the sheet and records the trim and bleed boxes", async () => {
    const pdf = await render(
      Document({ font: inter }, Page({ size: [200, 100], margin: 10, bleed: 9 }, Text("isi"))),
      { deterministic: true, compress: false },
    );
    expect(latin1(pdf)).toContain(
      "/MediaBox[0 0 218 118]/BleedBox[0 0 218 118]/TrimBox[9 9 209 109]",
    );
  });

  test("marks add room around the bleed", async () => {
    const pdf = await render(
      Document(
        { font: inter },
        Page({ size: [200, 100], margin: 10, bleed: 9, marks: true }, Text("isi")),
      ),
      { deterministic: true, compress: false },
    );
    const out = latin1(pdf);
    const margin = mm(10);
    const round = (value: number): string => String(Math.round(value * 1000) / 1000);
    expect(out).toContain(`/MediaBox[0 0 ${round(218 + margin * 2)} ${round(118 + margin * 2)}]`);
    expect(out).toContain(
      `/TrimBox[${round(9 + margin)} ${round(9 + margin)} ${round(209 + margin)} ${round(109 + margin)}]`,
    );
    // Registration colour: all four inks.
    expect(out).toContain("1 1 1 1 K");
  });

  test("the sheet colour and the background run into the bleed, and nothing runs past it", () => {
    const layout = layoutDocument(
      Document(
        Page(
          {
            size: [200, 100],
            margin: 10,
            bleed: 10,
            fill: "#ff0000",
            background: Absolute(
              { anchor: "page", top: 0, left: 0 },
              Box({ width: 30, height: 30, background: "#0000ff" }),
            ),
          },
          Text("isi"),
        ),
      ),
    );
    const [page] = layout.pages;
    expect(page).toMatchObject({ width: 200, height: 100, bleed: 10 });
    const corners = (page?.items ?? [])
      .filter((item) => item.type === "path")
      .map((item) => (item.type === "path" ? [item.commands[0]?.[1], item.commands[0]?.[2]] : []));
    // Both start at the corner of the bleed, ten points outside the finished page.
    expect(corners.slice(0, 2)).toEqual([
      [-10, -10],
      [-10, -10],
    ]);
  });

  test("the marks are where a printer expects them", async () => {
    const pdf = await render(
      Document(
        { font: inter },
        Page({ size: [200, 100], margin: 10, bleed: 9, marks: true, fill: "#ffcc00" }, Text("isi")),
      ),
      { deterministic: true },
    );
    const [image] = await renderPdf("pdfium", pdf, 2);
    expect(image).toBeDefined();
    if (!image) return;
    const at = (x: number, y: number): [number, number, number] => {
      const i = (Math.round(y * 2) * image.width + Math.round(x * 2)) * 4;
      return [
        image.pixels[i] as number,
        image.pixels[i + 1] as number,
        image.pixels[i + 2] as number,
      ];
    };
    const offset = 9 + mm(10);
    // Inside the bleed the sheet colour is printed; outside it the paper is bare.
    expect(at(offset - 5, offset + 50)[2]).toBeLessThan(80);
    expect(at(offset - 12, offset + 50)).toEqual([255, 255, 255]);
    // A crop mark: a dark line level with the top trim edge, left of the bleed.
    const dark = (pixel: [number, number, number]): boolean =>
      pixel[0] < 140 && pixel[1] < 140 && pixel[2] < 140;
    const marked = [-0.5, 0, 0.5].some((dy) => dark(at(offset - 9 - mm(4), offset + dy)));
    expect(marked).toBe(true);
    // And nothing where no mark belongs.
    expect(at(offset - 9 - mm(4), offset + 20)).toEqual([255, 255, 255]);
  });

  test("only the marks asked for are drawn", async () => {
    const out = async (marks: object | boolean): Promise<string> =>
      latin1(
        await render(
          Document({ font: inter }, Page({ size: [200, 100], margin: 10, marks }, Text("x"))),
          {
            deterministic: true,
            compress: false,
          },
        ),
      );
    // Registration targets are circles: four curves each.
    expect((await out({ crop: true })).match(/ c\n/g)).toBeNull();
    expect((await out({ registration: true })).match(/ c\n/g)).toHaveLength(16);
    expect(await out({})).not.toContain("1 1 1 1 K");
  });
});

describe("colour for print", () => {
  test("CMYK colours are written as CMYK", async () => {
    const pdf = await render(
      Document(
        { font: inter, color: cmyk(0, 0, 0, 1) },
        Page(
          { size: [200, 100], margin: 10 },
          Box({ background: cmyk(1, 0.5, 0, 0.1), height: 20 }),
          Text("hitam"),
        ),
      ),
      { deterministic: true, compress: false },
    );
    const out = latin1(pdf);
    expect(out).toContain("1 0.5 0 0.1 k");
    expect(out).toContain("0 0 0 1 k");
    expect(out).not.toMatch(/ rg\n/);
  });

  test("a spot colour is a separation with a process alternate", async () => {
    const pantone = spot("PANTONE 286 C", cmyk(1, 0.75, 0, 0.02));
    const pdf = await render(
      Document(
        { font: inter },
        Page(
          { size: [200, 100], margin: 10 },
          Box({
            background: pantone,
            height: 20,
            border: { width: 1, color: spot("PANTONE 286 C", cmyk(1, 0.75, 0, 0.02), 0.5) },
          }),
          Text({ color: pantone }, "warna khusus"),
        ),
      ),
      { deterministic: true, compress: false },
    );
    const out = latin1(pdf);
    expect(out).toContain(
      "[/Separation/PANTONE#20286#20C/DeviceCMYK<</FunctionType 2/Domain[0 1]/C0[0 0 0 0]/C1[1 0.75 0 0.02]/N 1>>]",
    );
    // One colour space for the ink, whatever tints are used.
    expect(out.match(/\/Separation/g)).toHaveLength(1);
    expect(out).toContain("/CS1 cs\n1 scn");
    expect(out).toContain("/CS1 CS\n0.5 SCN");
    expect(out).toMatch(/\/ColorSpace<<\/CS1 \d+ 0 R>>/);
  });

  test("spot colours are validated, and previewed with their alternate", () => {
    expect(() => spot("", cmyk(0, 0, 0, 1))).toThrow(/name/);
    expect(() => spot("X", { space: "rgb", r: 1, g: 0, b: 0 })).toThrow(/cmyk/);
    expect(() => spot("X", cmyk(0, 0, 0, 1), 2)).toThrow(RangeError);
    const [svg] = renderSvg(
      Document(
        Page(
          { size: [100, 100], margin: 10 },
          Box({ background: spot("Emas", cmyk(0, 1, 1, 0), 0.5), height: 10 }),
        ),
      ),
    );
    expect(svg).toContain('fill="rgb(255,128,128)"');
  });
});

describe("output intent and PDF/X-4", () => {
  const document = Document(
    { title: "Sertifikat <A&B>", author: "Panitia", font: inter },
    Page(
      { size: [200, 100], margin: 10, bleed: 9 },
      Text({ color: cmyk(0, 0, 0, 1) }, "siap cetak"),
    ),
  );

  test("writes the output intent with its profile", async () => {
    const pdf = await render(document, {
      deterministic: true,
      compress: false,
      conformance: "PDF/X-4",
      outputIntent: intent,
    });
    const out = latin1(pdf);
    expect(out).toMatch(
      /\/OutputIntents\[<<\/Type\/OutputIntent\/S\/GTS_PDFX\/OutputConditionIdentifier\(CGATS TR 001\)\/Info\(CGATS TR 001\)\/RegistryName\(http:\/\/www\.color\.org\)\/DestOutputProfile \d+ 0 R>>\]/,
    );
    expect(out).toContain(`<</N 4/Length ${env.icc.length}>>`);
    expect(out).toContain("/GTS_PDFXVersion(PDF/X-4)");
    expect(out).toContain("/Trapped/False");
    expect(out).toContain("<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>");
  });

  test.skipIf(!hasQpdf)("the file is structurally valid", async () => {
    const pdf = await render(document, {
      deterministic: true,
      conformance: "PDF/X-4",
      outputIntent: intent,
    });
    const output = qpdfCheck(pdf);
    expect(output).toContain("No syntax or stream encoding errors found");
    expect(output).not.toMatch(/^(WARNING|ERROR)/m);
  });

  test("a trim box is written even without bleed or marks", async () => {
    const plain = Document({ font: inter }, Page({ size: [200, 100], margin: 10 }, Text("x")));
    const out = latin1(
      await render(plain, {
        deterministic: true,
        compress: false,
        conformance: "PDF/X-4",
        outputIntent: intent,
      }),
    );
    expect(out).toContain("/MediaBox[0 0 200 100]/BleedBox[0 0 200 100]/TrimBox[0 0 200 100]");
  });

  test("refuses what the standard forbids", async () => {
    await expect(render(document, { conformance: "PDF/X-4" })).rejects.toThrow(
      /needs an output intent/,
    );
    const helvetica = Document(
      Page({ size: [200, 100], margin: 10 }, Text({ font: StandardFonts.Helvetica }, "x")),
    );
    await expect(
      render(helvetica, { conformance: "PDF/X-4", outputIntent: intent }),
    ).rejects.toThrow(/every font to be embedded/);
    await expect(
      render(document, { outputIntent: { profile: new Uint8Array(200), identifier: "x" } }),
    ).rejects.toThrow(/not an ICC profile/);
    const raw = new PdfDocument({ conformance: "PDF/X-4", outputIntent: intent });
    raw.addPage({ size: [100, 100] });
    expect(() => raw.finish()).toThrow(/trim box on every page/);
  });

  test("an output intent can be given without claiming a standard", async () => {
    const out = latin1(
      await render(document, { deterministic: true, compress: false, outputIntent: intent }),
    );
    expect(out).toContain("/OutputIntents[");
    expect(out).not.toContain("GTS_PDFXVersion");
  });
});

describe("metadata", () => {
  test("is written as XMP too, readable without decompressing", async () => {
    const pdf = await render(
      Document(
        {
          title: "Faktur <A&B>",
          author: "PT Contoh",
          subject: "Uji",
          keywords: "faktur, uji",
          creator: "Aplikasi",
        },
        Page({ size: [100, 100], margin: 10 }, Text("x")),
      ),
      { deterministic: true },
    );
    const out = latin1(pdf);
    expect(out).toContain("/Type/Metadata/Subtype/XML");
    expect(out).toContain('<rdf:li xml:lang="x-default">Faktur &lt;A&amp;B&gt;</rdf:li>');
    expect(out).toContain("<rdf:li>PT Contoh</rdf:li>");
    expect(out).toContain("<pdf:Keywords>faktur, uji</pdf:Keywords>");
    expect(out).toContain("<xmp:CreatorTool>Aplikasi</xmp:CreatorTool>");
    expect(out).toContain("<pdf:Producer>mbingpdf</pdf:Producer>");
    // Deterministic output carries no dates.
    expect(out).not.toContain("xmp:CreateDate");
  });

  test("dates agree between XMP and the information dictionary", async () => {
    const out = latin1(
      await render(Document(Page({ size: [100, 100], margin: 10 }, Text("x"))), {
        compress: false,
      }),
    );
    const info = /\/CreationDate\(D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z\)/.exec(out);
    const xmp =
      /<xmp:CreateDate>(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z<\/xmp:CreateDate>/.exec(
        out,
      );
    expect(info).not.toBeNull();
    expect(xmp?.slice(1)).toEqual(info?.slice(1));
  });
});

describe("image resolution", () => {
  test("warns about images that would print blurred", async () => {
    const warnings: string[] = [];
    const photo = new Uint8Array(readFileSync(new URL("./images/photo.jpg", import.meta.url)));
    const document = Document(
      { font: inter },
      // 120 pixels across 150 points is 58 dpi; across 20 points it is 432 dpi.
      Page(
        { size: [200, 200], margin: 10 },
        Image({ src: photo, width: 150 }),
        Image({ src: photo, width: 20 }),
      ),
    );
    await render(document, {
      minImageDpi: 300,
      onWarning: (warning) => warnings.push(`${warning.code}: ${warning.message}`),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^low-resolution-image: An image on page 1 prints at 58 dpi, below the 300 dpi asked for/,
    );
    warnings.length = 0;
    await render(document, {
      minImageDpi: 50,
      onWarning: (warning) => warnings.push(warning.message),
    });
    expect(warnings).toEqual([]);
  });
});
