/** Tagged PDF: the logical structure written with the pages, and PDF/UA. */
import { describe, expect, test } from "vitest";
import { PdfDocument } from "../src/core/index.ts";
import {
  Box,
  Canvas,
  Document,
  Font,
  Heading,
  hyphenateEnglish,
  Image,
  type LayoutWarning,
  Link,
  List,
  Page,
  QrCode,
  Row,
  render,
  Stack,
  Svg,
  Table,
  TableOfContents,
  Text,
} from "../src/index.ts";
import { env, readFont } from "./harness/env.ts";
import { extractText, renderPdf, structureOutline } from "./harness/render.ts";
import { samples } from "./harness/samples.ts";

const inter = new Font(readFont("Inter-Variable"));
const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
const circle =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

describe("tagged PDF", () => {
  test("elements become the structure: headings, paragraphs, lists, figures", async () => {
    const document = Document(
      { font: inter, title: "Laporan", lang: "id" },
      Page(
        Heading("Laporan tahunan"),
        Text("Paragraf pertama."),
        Heading({ level: 2 }, "Daftar"),
        List({ marker: "decimal" }, "Satu", Text("Dua")),
        Image({ src: env.photo, width: 60, alt: "Foto kantor" }),
        Svg({ src: circle, width: 20, alt: "Lingkaran" }),
        QrCode({ value: "https://example.com/t/1", size: 40 }),
        Canvas({ width: 30, height: 10, alt: "Garis", draw: (g) => g.rect(0, 0, 30, 10).fill() }),
      ),
    );
    const pdf = await render(document, { tagged: true });
    expect(await structureOutline(pdf)).toEqual([
      [
        "Document",
        "  H1: Laporan tahunan",
        "  P: Paragraf pertama.",
        "  H2: Daftar",
        "  L",
        "    LI",
        "      Lbl: 1.",
        "      LBody",
        "        P: Satu",
        "    LI",
        "      Lbl: 2.",
        "      LBody",
        "        P: Dua",
        "  Figure [Foto kantor]",
        "  Figure [Lingkaran]",
        "  Figure [QR code: https://example.com/t/1]",
        "  Figure [Garis]",
      ],
    ]);
    const plain = latin1(await render(document, { tagged: true, compress: false }));
    expect(plain).toContain("/MarkInfo<</Marked true>>");
    expect(plain).toContain("/ViewerPreferences<</DisplayDocTitle true>>");
    expect(plain).toContain("/Tabs/S");
    expect(plain).toContain("/StructParents 0");
  });

  test("an untagged file has none of it", async () => {
    const document = Document({ font: inter }, Page(Text("biasa")));
    const plain = latin1(await render(document, { compress: false }));
    expect(plain).not.toContain("StructTreeRoot");
    // The operator itself, not the letters: the file's identifier is random hex.
    expect(plain).not.toMatch(/ (BDC|BMC)\n/);
    expect(plain).not.toContain("/Tabs");
    expect(await structureOutline(await render(document))).toEqual([[]]);
  });

  test("backgrounds, borders, rules, headers and footers are artifacts", async () => {
    const document = Document(
      { font: inter },
      Page(
        {
          fill: "#FFFBEB",
          header: Text("Kepala halaman"),
          footer: ({ page }) => Text(`Halaman ${page}`),
        },
        Box({ background: "#EEF2FF", border: { width: 1, color: "#6366F1" } }, Text("isi")),
      ),
    );
    const pdf = await render(document, { tagged: true, compress: false });
    expect(await structureOutline(pdf)).toEqual([["Document", "  P: isi"]]);
    const plain = latin1(pdf);
    expect(plain).toContain("/Artifact <</Type/Pagination/Subtype/Header>> BDC");
    expect(plain).toContain("/Artifact <</Type/Pagination/Subtype/Footer>> BDC");
    expect(plain).toContain("/Artifact BMC");
    // Every run that is opened is closed.
    const begun = plain.match(/\b(BDC|BMC)\n/g)?.length ?? 0;
    expect(begun).toBeGreaterThan(3);
    expect(plain.match(/\bEMC\n/g)?.length).toBe(begun);
    // The text is all still there for ordinary extraction.
    expect((await extractText(pdf))[0]).toEqual(["Kepala halaman", "isi", "Halaman 1"]);
  });

  test("a table: header cells with their scope, rows, spans", async () => {
    const document = Document(
      { font: inter },
      Page(
        Table({
          columns: 2,
          header: ["Barang", "Harga"],
          rows: [
            ["Bus", "Rp 3.500.000"],
            ["Tiket", "Rp 750.000"],
          ],
        }),
      ),
    );
    const pdf = await render(document, { tagged: true, compress: false });
    expect((await structureOutline(pdf))[0]).toEqual([
      "Document",
      "  Table",
      "    TR",
      "      TH",
      "        P: Barang",
      "      TH",
      "        P: Harga",
      "    TR",
      "      TD",
      "        P: Bus",
      "      TD",
      "        P: Rp 3.500.000",
      "    TR",
      "      TD",
      "        P: Tiket",
      "      TD",
      "        P: Rp 750.000",
    ]);
    expect(latin1(pdf).match(/\/A<<\/O\/Table\/Scope\/Column>>/g)).toHaveLength(2);
  });

  test("a table over several pages is one table; its repeated header is an artifact", async () => {
    const rows = Array.from({ length: 120 }, (_row, i) => [`Baris ${i + 1}`, String(i)]);
    const document = Document(
      { font: inter },
      Page(Table({ columns: 2, header: ["Nama", "Nilai"], rows })),
    );
    const pdf = await render(document, { tagged: true, compress: false });
    const outline = await structureOutline(pdf);
    expect(outline.length).toBeGreaterThan(2);
    const plain = latin1(pdf);
    expect(plain.match(/\/S\/Table\b/g)).toHaveLength(1);
    expect(plain.match(/\/S\/TH\b/g)).toHaveLength(2);
    expect(plain.match(/\/S\/TR\b/g)).toHaveLength(121);
    // On the second page the header is drawn but is not in the structure.
    expect((await extractText(pdf))[1]?.slice(0, 2)).toEqual(["Nama", "Nilai"]);
    expect(outline[1]?.join("\n")).not.toContain("Nama");
    expect(outline[1]?.slice(0, 3)).toEqual(["Document", "  Table", "    TR"]);
  });

  test("a paragraph that runs onto the next page is one paragraph", async () => {
    const long = "Kalimat yang diulang supaya paragraf ini melewati batas halaman. ".repeat(120);
    const document = Document({ font: inter }, Page({ size: "A5" }, Text(long)));
    const pdf = await render(document, { tagged: true, compress: false });
    const outline = await structureOutline(pdf);
    expect(outline.length).toBeGreaterThan(1);
    expect(latin1(pdf).match(/\/S\/P\b/g)).toHaveLength(1);
    // Content on later pages is tied to the element by page and number.
    expect(latin1(pdf)).toMatch(/\/Type\/MCR\/Pg \d+ 0 R\/MCID 0/);
  });

  test("a hyphen added at a line break reads as a soft hyphen; a real one stays", async () => {
    const document = Document(
      { font: inter },
      Page(
        { size: [120, 300], margin: 10 },
        Text(
          { hyphenate: hyphenateEnglish, size: 11 },
          "An e-mail about internationalization and extraordinarily long words.",
        ),
      ),
    );
    const pdf = await render(document, { tagged: true, compress: false });
    // The added hyphen is drawn, but stands for U+00AD (ISO 32000-1, 14.8.2.2.3), which
    // readers leave out: the structure has the word whole, and the real hyphen stays.
    const soft = latin1(pdf).match(/<([0-9A-F]{4})> <00AD>/)?.[1];
    expect(soft).toBeDefined();
    // It is still drawn: its glyph is shown in the content.
    expect(latin1(pdf)).toMatch(
      new RegExp(`<(?:[0-9a-f]{4})*${soft}(?:[0-9a-f]{4})*>[^\\]]*\\] TJ`, "i"),
    );
    const text = (await structureOutline(pdf))[0]?.join(" ") ?? "";
    expect(text).toContain("internationalization");
    expect(text).toContain("e-mail");
  });

  test("a link is a Link element that owns its annotation, with a description", async () => {
    const document = Document(
      { font: inter },
      Page(
        { footer: Text(Link({ href: "https://example.com/kaki" }, "kaki")) },
        Text(
          "Lihat ",
          Link({ href: "https://example.com" }, "situs kami"),
          " dan ",
          Link({ to: "akhir" }, "bagian akhir"),
          ".",
        ),
        Text({ id: "akhir" }, "Akhir."),
      ),
    );
    const pdf = await render(document, { tagged: true, compress: false });
    expect((await structureOutline(pdf))[0]).toEqual([
      "Document",
      "  P: Lihat dan.",
      "    Link (1 link): situs kami",
      "    Link (1 link): bagian akhir",
      "  P: Akhir.",
      // The footer's link: its text is page furniture, its annotation still needs an owner.
      "  Link (1 link)",
    ]);
    const plain = latin1(pdf);
    expect(plain).toContain("/Contents(https://example.com)");
    expect(plain).toContain("/Contents(Go to akhir)");
    expect(plain.match(/\/Type\/OBJR/g)).toHaveLength(3);
    expect(plain.match(/\/StructParent \d+/g)).toHaveLength(3);
  });

  test("role, decorative and alt say what the layout cannot know", async () => {
    const warnings: LayoutWarning[] = [];
    const document = Document(
      { font: inter },
      Page(
        Stack({ role: "Sect" }, Text({ role: "Caption" }, "Keterangan"), Text("Isi bagian")),
        Row({ decorative: true }, Text("hiasan")),
        Image({ src: env.photo, width: 40, decorative: true }),
        Image({ src: env.photo, width: 40, alt: "" }),
        Image({ src: env.photo, width: 40 }),
      ),
    );
    const pdf = await render(document, {
      tagged: true,
      onWarning: (warning) => warnings.push(warning),
    });
    expect((await structureOutline(pdf))[0]).toEqual([
      "Document",
      "  Sect",
      "    Caption: Keterangan",
      "    P: Isi bagian",
    ]);
    expect(warnings).toEqual([
      {
        code: "missing-alt-text",
        message: expect.stringContaining("Give it an `alt`"),
        path: "Document > Page[0] > Image[4]",
      },
    ]);
    // Untagged, nobody is bothered about descriptions.
    const quiet: LayoutWarning[] = [];
    await render(document, { onWarning: (warning) => quiet.push(warning) });
    expect(quiet).toEqual([]);
  });

  test("a table of contents is a TOC of entries that link to their headings", async () => {
    const document = Document(
      { font: inter },
      Page(TableOfContents(), Heading("Satu"), Text("isi"), Heading("Dua"), Text("isi")),
    );
    const outline = (await structureOutline(await render(document, { tagged: true })))[0] ?? [];
    expect(outline.slice(0, 8)).toEqual([
      "Document",
      "  TOC",
      "    TOCI",
      "      Reference",
      "        Link (1 link): Satu",
      "      Reference",
      "        Link (1 link): 1",
      "    TOCI",
    ]);
  });

  test("tagging changes nothing that is seen", async () => {
    const sample = samples.agreement as (typeof samples)[string];
    const plain = await renderPdf("pdfium", sample.build(env));
    const tagged = await renderPdf("pdfium", sample.build(env, { tagged: true }));
    expect(tagged.length).toBe(plain.length);
    tagged.forEach((page, i) => {
      expect(Buffer.from(page.pixels).equals(Buffer.from(plain[i]?.pixels as Uint8Array))).toBe(
        true,
      );
    });
  });
});

describe("PDF/UA", () => {
  const document = Document(
    { font: inter, title: "Laporan", lang: "id" },
    Page(Heading("Laporan"), Text("Isi.")),
  );

  test("declares itself and is tagged without being asked", async () => {
    const plain = latin1(await render(document, { conformance: "PDF/UA-1", compress: false }));
    expect(plain).toContain("<pdfuaid:part>1</pdfuaid:part>");
    expect(plain).toContain("/StructTreeRoot");
    expect(plain).toContain("/Lang(id)");
    // Together with PDF/A, the PDF/UA property has to be described to the archive.
    const both = latin1(
      await render(document, { conformance: ["PDF/UA-1", "PDF/A-2a"], compress: false }),
    );
    expect(both).toContain("<pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>");
    expect(both).toContain("<pdfaid:conformance>A</pdfaid:conformance>");
  });

  test("needs a title, a language and embedded fonts", async () => {
    const options = { conformance: "PDF/UA-1" } as const;
    await expect(
      render(Document({ font: inter, lang: "id" }, Page(Text("x"))), options),
    ).rejects.toThrow("PDF/UA needs the document to have a title");
    await expect(
      render(Document({ font: inter, title: "x" }, Page(Text("x"))), options),
    ).rejects.toThrow("PDF/UA needs the language of the document");
    await expect(
      render(Document({ title: "x", lang: "id" }, Page(Text("x"))), options),
    ).rejects.toThrow("PDF/UA requires every font to be embedded");
  });

  test("the low-level writer: structure and marked content by hand", () => {
    const doc = new PdfDocument({ tagged: true, compress: false, deterministic: true });
    const page = doc.addPage({ size: [200, 100] });
    const paragraph = doc.structure.add("P", { lang: "en" });
    page.beginContent(paragraph);
    page.content.rect(10, 10, 20, 20).fill();
    page.endContent();
    page.beginArtifact({ type: "Layout" }).content.rect(0, 0, 200, 1).fill();
    page.endContent();
    const plain = latin1(doc.finish());
    expect(plain).toContain("/P <</MCID 0>> BDC");
    expect(plain).toContain("/Artifact <</Type/Layout>> BDC");
    expect(plain).toMatch(/\/Type\/StructElem\/S\/P\/P \d+ 0 R\/Pg \d+ 0 R\/K 0\/Lang\(en\)/);
    expect(plain).toContain("/ParentTreeNextKey 1");
    expect(() => new PdfDocument().structure).toThrow("not tagged");
    const untagged = new PdfDocument();
    expect(() => untagged.addPage({ size: [10, 10] }).beginContent(paragraph)).toThrow(
      "needs a tagged document",
    );
  });
});
