import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { certificate } from "../../../examples/certificate.ts";
import { invoice, sampleInvoice } from "../../../examples/invoice.ts";
import { labelSheet, sampleLabels } from "../../../examples/label-sheet.ts";
import { letter } from "../../../examples/letter.ts";
import { report } from "../../../examples/report.ts";
import { type LayoutNode, render } from "../src/index.ts";
import { extractText } from "./harness/render.ts";

const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;

/** Renders a template strictly (any warning fails) and checks the file's structure. */
async function build(document: LayoutNode): Promise<string[][]> {
  const pdf = await render(document, { deterministic: true, strict: true });
  if (hasQpdf) {
    const dir = mkdtempSync(join(tmpdir(), "mbingpdf-"));
    try {
      const file = join(dir, "out.pdf");
      writeFileSync(file, pdf);
      const result = spawnSync("qpdf", ["--check", file], { encoding: "utf8" });
      expect(result.stdout + result.stderr).toContain("No syntax or stream encoding errors found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return extractText(pdf);
}

describe("starter templates", () => {
  test("invoice: line items, totals and a numbered footer", async () => {
    const pages = await build(invoice());
    expect(pages).toHaveLength(1);
    const text = pages[0]?.join(" ") ?? "";
    expect(text).toContain("INVOICE");
    expect(text).toContain("Rp 4.850.000");
    // 11% tax on the subtotal.
    expect(text).toContain("Rp 533.500");
    expect(text).toContain("Rp 5.383.500");
    expect(text).toContain("Halaman 1 dari 1");
  });

  test("invoice: a long list of items runs onto more pages with the header repeated", async () => {
    const items = Array.from({ length: 80 }, (_value, i) => ({
      description: `Barang ${i + 1}`,
      quantity: 1,
      unitPrice: 1000,
    }));
    const pages = await build(invoice({ ...sampleInvoice, items }));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[1]?.slice(0, 4)).toEqual(["Uraian", "Jml", "Harga satuan", "Jumlah"]);
    expect(pages.at(-1)?.join(" ")).toContain("Rp 80.000");
  });

  test("report: a cover, contents that match the chapters, and page numbers", async () => {
    const pages = await build(report());
    expect(pages.length).toBeGreaterThanOrEqual(5);
    expect(pages[0]?.join(" ")).toContain("Laporan Tahunan 2026");
    const contents = pages[1] ?? [];
    expect(contents).toContain("Daftar Isi");
    // Each chapter is on the page the contents say it is.
    for (const title of [
      "1. Pendahuluan",
      "2. Kegiatan",
      "3. Keuangan",
      "4. Rencana tahun depan",
    ]) {
      const listed = Number(contents[contents.indexOf(title) + 1]);
      expect(pages[listed - 1], title).toContain(title);
    }
  });

  test("letter: fits one page and keeps the closing with the signature", async () => {
    const pages = await build(letter());
    expect(pages).toHaveLength(1);
    const text = pages[0] ?? [];
    expect(text.indexOf("Hormat kami,")).toBeLessThan(text.indexOf("Budi Santoso"));
  });

  test("certificate: one page, on screen or with bleed and marks for print", async () => {
    expect(await build(certificate())).toHaveLength(1);
    const print = await render(certificate(undefined, { bleed: true }), {
      deterministic: true,
      compress: false,
    });
    expect(new TextDecoder("latin1").decode(print)).toContain("/TrimBox[");
  });

  test("label sheet: twenty-four labels to a sheet", async () => {
    const pages = await build(labelSheet());
    expect(pages).toHaveLength(Math.ceil(sampleLabels.length / 24));
    expect(pages[0]?.filter((text) => text.startsWith("Peserta"))).toHaveLength(24);
  });
});
