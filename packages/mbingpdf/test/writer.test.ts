import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  dict,
  name,
  PdfDocument,
  type PdfDocumentOptions,
  PdfStream,
  PdfWriter,
} from "../src/core/index.ts";

const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;

/** Runs `qpdf --check`; returns its output and whether the file is free of errors and warnings. */
function qpdfCheck(pdf: Uint8Array): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "mbingpdf-"));
  try {
    const file = join(dir, "out.pdf");
    writeFileSync(file, pdf);
    const result = spawnSync("qpdf", ["--check", file], { encoding: "utf8" });
    return { ok: result.status === 0, output: result.stdout + result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sample(options: PdfDocumentOptions = {}, pages = 3): Uint8Array {
  const doc = new PdfDocument({
    deterministic: true,
    info: { title: "Faktur — contoh", author: "mbingpdf tests" },
    ...options,
  });
  for (let i = 0; i < pages; i++) {
    const y = 100 + i * 50;
    doc.addPage({
      size: [595.276, 841.89],
      content: ascii(`0.2 0.4 0.8 rg\n72 ${y} 200 100 re\nf\n`.repeat(4)),
    });
  }
  return doc.finish();
}

const variants: [string, PdfDocumentOptions][] = [
  ["xref stream, compressed", {}],
  ["xref stream, uncompressed", { compress: false }],
  ["xref table, compressed", { xref: "table" }],
  ["xref table, uncompressed", { xref: "table", compress: false }],
  ["PDF 2.0", { version: "2.0" }],
];

describe("PdfDocument", () => {
  test("starts with the header and ends with %%EOF", () => {
    const text = latin1(sample());
    expect(text.startsWith("%PDF-1.7\n%")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(latin1(sample({ version: "2.0" })).startsWith("%PDF-2.0\n")).toBe(true);
  });

  test("xref table offsets point at the objects they name", () => {
    const pdf = sample({ xref: "table", compress: false });
    const text = latin1(pdf);
    const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
    expect(text.slice(start, start + 5)).toBe("xref\n");
    const rows = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)];
    expect(rows.length).toBeGreaterThan(5);
    rows.forEach((row, i) => {
      const offset = Number(row[1]);
      expect(text.slice(offset, offset + `${i + 1} 0 obj\n`.length)).toBe(`${i + 1} 0 obj\n`);
    });
  });

  test("the same input gives the same bytes", () => {
    expect(sample()).toEqual(sample());
    expect(sample({ xref: "table" })).toEqual(sample({ xref: "table" }));
  });

  test("different content gives a different file identifier", () => {
    const id = (pdf: Uint8Array): string | undefined =>
      /\/ID\[<([0-9A-F]{32})>/.exec(latin1(pdf))?.[1];
    const a = id(sample({ xref: "table" }));
    const b = id(sample({ xref: "table", info: { title: "Other" } }));
    expect(a).toMatch(/^[0-9A-F]{32}$/);
    expect(b).toMatch(/^[0-9A-F]{32}$/);
    expect(a).not.toBe(b);
  });

  test("stamps the current time unless deterministic", () => {
    const build = (options: PdfDocumentOptions): string => {
      const doc = new PdfDocument({ xref: "table", compress: false, ...options });
      doc.addPage({ size: [100, 100] });
      return latin1(doc.finish());
    };
    const stamped = build({});
    expect(stamped).toMatch(/\/CreationDate\(D:\d{14}Z\)/);
    const fixed = build({ deterministic: true });
    expect(fixed).not.toContain("/CreationDate");
  });

  test("compression makes the file smaller", () => {
    expect(sample({}, 20).length).toBeLessThan(sample({ compress: false }, 20).length);
  });

  test("rejects a page with no area", () => {
    expect(() => new PdfDocument().addPage({ size: [0, 100] })).toThrow(RangeError);
  });

  test.skipIf(!hasQpdf).each(variants)("qpdf --check passes: %s", (_label, options) => {
    const result = qpdfCheck(sample(options));
    expect(result.output).not.toMatch(/^(WARNING|ERROR)/m);
    expect(result.output).toContain("No syntax or stream encoding errors found");
    expect(result.ok).toBe(true);
  });

  test.skipIf(!hasQpdf)("qpdf --check passes with several object streams", () => {
    const result = qpdfCheck(sample({}, 350));
    expect(result.output).not.toMatch(/^(WARNING|ERROR)/m);
    expect(result.output).toContain("No syntax or stream encoding errors found");
    expect(result.ok).toBe(true);
  });

  test("refuses to finish without a page", () => {
    expect(() => new PdfDocument().finish()).toThrow(/at least one page/);
  });
});

describe("PdfWriter", () => {
  test("refuses to write an object twice", () => {
    const writer = new PdfWriter();
    const ref = writer.add(dict({ Type: name("Catalog") }));
    expect(() => writer.set(ref, null)).toThrow(/already written/);
  });

  test("refuses to finish while an allocated object is missing", () => {
    const writer = new PdfWriter();
    const root = writer.add(dict({ Type: name("Catalog") }));
    writer.allocate();
    expect(() => writer.finish({ root })).toThrow(/never written/);
  });

  test("cannot be used after finish", () => {
    const writer = new PdfWriter();
    const root = writer.add(dict({ Type: name("Catalog") }));
    writer.finish({ root });
    expect(() => writer.add(null)).toThrow(/finished/);
  });

  test("keeps a stream's own filter and does not compress it again", () => {
    const writer = new PdfWriter({ xref: "table" });
    const data = new Uint8Array(500);
    writer.add(new PdfStream(data, dict({ Filter: name("DCTDecode") })));
    const root = writer.add(dict({ Type: name("Catalog") }));
    const text = latin1(writer.finish({ root }));
    expect(text).toContain("<</Filter/DCTDecode/Length 500>>");
  });

  test("leaves incompressible data unfiltered", () => {
    const writer = new PdfWriter({ xref: "table" });
    writer.add(new PdfStream(new Uint8Array([1, 2, 3])));
    const root = writer.add(dict({ Type: name("Catalog") }));
    expect(latin1(writer.finish({ root }))).toContain("<</Length 3>>");
  });
});
