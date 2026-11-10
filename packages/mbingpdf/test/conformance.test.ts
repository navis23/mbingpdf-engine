/** Archival standards (PDF/A): what the library writes, and what the reference validator says. */
import { describe, expect, test } from "vitest";
import { PdfDocument, srgbProfile } from "../src/core/index.ts";
import {
  Absolute,
  Box,
  Cell,
  cmyk,
  Document,
  Font,
  Heading,
  Image,
  Link,
  List,
  Page,
  QrCode,
  render,
  Stack,
  StandardFonts,
  Svg,
  Table,
  TableOfContents,
  Text,
} from "../src/index.ts";
import { env, readFont } from "./harness/env.ts";
import { samples } from "./harness/samples.ts";
import { validate, veraPdf } from "./harness/verapdf.ts";

const inter = new Font(readFont("Inter-Variable"));
const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

/** The test profile with its class set to "printer", as a real press profile has. */
function pressProfile(): Uint8Array {
  const profile = env.icc.slice();
  profile.set([0x70, 0x72, 0x74, 0x72], 12);
  return profile;
}

const hello = Document(
  { title: "Arsip", lang: "id", font: inter },
  Page(Text("Disimpan untuk waktu yang lama. ", Link({ href: "https://example.com" }, "Tautan"))),
);

describe("PDF/A", () => {
  test("the built-in sRGB profile is a well-formed ICC profile", () => {
    const profile = srgbProfile();
    const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
    expect(view.getUint32(0)).toBe(profile.length);
    expect(latin1(profile.subarray(12, 24))).toBe("mntrRGB XYZ ");
    expect(latin1(profile.subarray(36, 40))).toBe("acsp");
    // Every tag lies inside the file, on a four-byte boundary.
    const count = view.getUint32(128);
    expect(count).toBe(9);
    for (let i = 0; i < count; i++) {
      const offset = view.getUint32(132 + i * 12 + 4);
      const size = view.getUint32(132 + i * 12 + 8);
      expect(offset % 4).toBe(0);
      expect(offset + size).toBeLessThanOrEqual(profile.length);
    }
    expect(profile.length).toBeLessThan(1200);
  });

  test("declares the standard and an sRGB output intent", async () => {
    const pdf = latin1(
      await render(hello, { conformance: "PDF/A-2u", deterministic: true, compress: false }),
    );
    expect(pdf).toContain("<pdfaid:part>2</pdfaid:part>");
    expect(pdf).toContain("<pdfaid:conformance>U</pdfaid:conformance>");
    expect(pdf).toContain("/S/GTS_PDFA1");
    expect(pdf).toContain("(sRGB IEC61966-2.1)");
    expect(pdf).not.toContain("DefaultRGB");
    // A link must stay visible in print for an archive.
    expect(pdf).toContain("/F 4");
    const third = latin1(await render(hello, { conformance: "PDF/A-3b", compress: false }));
    expect(third).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(third).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
  });

  test("with a press profile, screen colours are read as sRGB", async () => {
    const document = Document(
      { font: inter },
      Page(Text({ color: "#B91C1C" }, "merah"), Text({ color: cmyk(1, 0, 0, 0) }, "sian")),
    );
    const pdf = latin1(
      await render(document, {
        conformance: ["PDF/A-2b"],
        outputIntent: { profile: pressProfile(), identifier: "CGATS TR 001" },
        compress: false,
      }),
    );
    expect(pdf).toContain("/DefaultRGB");
    expect(pdf).toContain("/ICCBased");
  });

  test("says what cannot be archived", async () => {
    await expect(
      render(Document(Page(Text("Helvetica"))), { conformance: "PDF/A-2b" }),
    ).rejects.toThrow("PDF/A requires every font to be embedded");
    await expect(
      render(Document({ font: inter }, Page(Text({ color: cmyk(1, 0, 0, 0) }, "sian"))), {
        conformance: "PDF/A-2b",
      }),
    ).rejects.toThrow("need a CMYK output intent");
    // The stand-in test profile calls itself a scanner profile.
    await expect(
      render(hello, {
        conformance: "PDF/A-2b",
        outputIntent: { profile: env.icc, identifier: "x" },
      }),
    ).rejects.toThrow('this one is of class "scnr"');
    expect(() => new PdfDocument({ conformance: ["PDF/A-2b", "PDF/A-3b"] })).toThrow(
      "one PDF/A level",
    );
    expect(StandardFonts.Helvetica).toBeDefined();
  });
});

describe.skipIf(!veraPdf).concurrent("veraPDF", () => {
  const sample = (name: string) => samples[name] as (typeof samples)[string];
  const press = { ...env, icc: pressProfile() };

  test("the samples are valid at every PDF/A level; a plain file is not", async () => {
    const files: Record<string, Uint8Array> = { plain: sample("invoice").build(env) };
    const expected: Record<string, string> = {};
    for (const level of ["2b", "2u", "2a", "3b", "3u", "3a"] as const) {
      const conformance = `PDF/A-${level}` as const;
      for (const name of ["invoice", "agreement", "tour"]) {
        files[`${name}-${level}`] = sample(name).build(env, { conformance });
        expected[`${name}-${level}`] = `${level}: ok`;
      }
      // Print-ready and archived at once, with a press profile and CMYK colours.
      files[`certificate-${level}`] = sample("certificate").build(press, {
        conformance: ["PDF/X-4", conformance],
      });
      expected[`certificate-${level}`] = `${level}: ok`;
    }
    const { plain, ...verdicts } = await validate(files, "auto");
    expect(verdicts).toEqual(expected);
    expect(plain).not.toMatch(/ok$/);
  }, 180_000);

  test("the samples are valid PDF/UA-1; a file that is only tagged in name is not", async () => {
    const conformance = "PDF/UA-1";
    const circle =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    // Everything the structure has a word for, over several pages.
    const everything = Document(
      { title: "Semua unsur", lang: "id", font: inter },
      Page(
        {
          header: Text("Kepala"),
          footer: ({ page, pages }) =>
            Text(`Halaman ${page} dari ${pages} `, Link({ href: "https://example.com" }, "situs")),
        },
        TableOfContents(),
        Heading("Bagian pertama"),
        Text(
          "Lihat ",
          Link({ href: "https://example.com" }, "situs kami"),
          " atau ",
          Link({ to: "tabel" }, "tabel"),
          ".",
        ),
        List({ marker: "decimal" }, "Satu", Stack(Text("Dua"), List("a", "b"))),
        Image({ src: env.photo, width: 80, alt: "Foto" }),
        Svg({ src: circle, width: 20, alt: "Lingkaran" }),
        Svg({ src: circle, width: 20, decorative: true }),
        QrCode({ value: "https://example.com/t/1", size: 40 }),
        Box({ opacity: 0.5, background: "#EEF2FF", padding: 6 }, Text("Pudar")),
        Absolute({ top: 40, right: 10, rotate: 30, opacity: 0.4 }, Text("Miring")),
        Heading({ level: 2, id: "tabel" }, "Tabel panjang"),
        Table({
          columns: 3,
          header: ["Nama", "Jumlah", "Harga"],
          rows: Array.from({ length: 90 }, (_row, i) => [`Baris ${i}`, i, `Rp ${i}.000`]),
          footer: [[Cell({ colSpan: 2 }, "Total"), "Rp 4.005.000"]],
          repeatFooter: true,
        }),
        Text({ break: "before" }, "Paragraf panjang. ".repeat(600)),
      ),
    );
    const files = {
      invoice: sample("invoice").build(env, { conformance }),
      agreement: sample("agreement").build(env, { conformance }),
      tour: sample("tour").build(env, { conformance }),
      certificate: sample("certificate").build(press, {
        conformance: ["PDF/X-4", "PDF/A-2a", conformance],
      }),
      everything: await render(everything, { conformance }),
      // Claims the standard's structure but has untagged content: a page drawn by hand.
      untagged: (() => {
        const doc = new PdfDocument({ conformance, info: { title: "x" }, lang: "id" });
        doc
          .addPage({ size: [100, 100] })
          .content.rect(10, 10, 20, 20)
          .fill();
        return doc.finish();
      })(),
    };
    const { untagged, ...verdicts } = await validate(files, "ua1");
    expect(verdicts).toEqual({
      invoice: "ua1: ok",
      agreement: "ua1: ok",
      tour: "ua1: ok",
      certificate: "ua1: ok",
      everything: "ua1: ok",
    });
    expect(untagged).not.toMatch(/ok$/);
  }, 180_000);
});
