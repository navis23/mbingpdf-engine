import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import * as hb from "harfbuzzjs";
import { describe, expect, test } from "vitest";
import { PdfDocument } from "../src/core/index.ts";
import { decodeWoff2, Font, isWoff2, loadFont, unwrapFont } from "../src/font/index.ts";
import { parseSfnt } from "../src/font/sfnt.ts";
import { readFont } from "./harness/env.ts";
import { extractText } from "./harness/render.ts";

const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fonts/${name}`, import.meta.url)));
const brotli = (data: Uint8Array): Uint8Array => new Uint8Array(brotliDecompressSync(data));

const CASES = [
  ["BarlowCondensed-Regular.woff2", "BarlowCondensed-Regular"],
  ["PlusJakartaSans-Variable.woff2", "PlusJakartaSans-Variable"],
] as const;

describe("WOFF2", () => {
  test.each(CASES)("%s decodes to the font it was made from", (file, original) => {
    const woff2 = read(file);
    expect(isWoff2(woff2)).toBe(true);
    const decoded = decodeWoff2(woff2, brotli);
    const source = readFont(original);
    expect(isWoff2(decoded)).toBe(false);

    // Tables that WOFF2 stores as they are must come back byte for byte.
    const got = parseSfnt(decoded).tables;
    const want = parseSfnt(source).tables;
    for (const [tag, table] of want) {
      if (tag === "DSIG") continue; // the signature cannot survive recompression
      expect(got.has(tag), `table ${tag}`).toBe(true);
      if (tag === "glyf" || tag === "loca" || tag === "head" || tag === "hmtx") continue;
      expect(got.get(tag), `table ${tag}`).toEqual(table);
    }
    expect(got.get("hmtx")).toEqual(want.get("hmtx"));

    // Glyph outlines are re-encoded, so compare what they draw.
    const a = new hb.Font(new hb.Face(new hb.Blob(decoded.slice().buffer)));
    const b = new hb.Font(new hb.Face(new hb.Blob(source.slice().buffer)));
    const font = new Font(decoded);
    for (let glyph = 0; glyph < font.numGlyphs; glyph++) {
      expect(a.glyphToPath(glyph), `outline of glyph ${glyph}`).toBe(b.glyphToPath(glyph));
      expect(a.glyphHAdvance(glyph)).toBe(b.glyphHAdvance(glyph));
    }

    // And the whole-file checksum is valid again.
    let sum = 0;
    const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    for (let i = 0; i + 4 <= decoded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });

  test("loadFont reads WOFF2, including variable fonts, and plain fonts alike", async () => {
    const fromWoff2 = await loadFont(read("PlusJakartaSans-Variable.woff2"), { wght: 700 });
    const fromTtf = new Font(readFont("PlusJakartaSans-Variable")).instance({ wght: 700 });
    expect(fromWoff2.postScriptName).toBe("PlusJakartaSans-Bold");
    const text = "Sertifikat Penghargaan — AVATAR";
    expect(fromWoff2.shape(text)).toEqual(fromTtf.shape(text));
    expect((await loadFont(readFont("BarlowCondensed-Regular"))).familyName).toBe(
      "Barlow Condensed",
    );
    const plain = readFont("BarlowCondensed-Regular");
    expect(await unwrapFont(plain)).toBe(plain);
  });

  test("a WOFF2 font embeds and reads back like any other", async () => {
    const font = await loadFont(read("BarlowCondensed-Regular.woff2"));
    const doc = new PdfDocument({ deterministic: true });
    doc
      .addPage({ size: [300, 100] })
      .content.font(font, 18)
      .text("Halo dari WOFF2 — é", 10, 40);
    expect(await extractText(doc.finish())).toEqual([["Halo dari WOFF2 — é"]]);
  });

  test("the browser path, with the streaming decoder, gives the same bytes", async () => {
    const woff2 = read("BarlowCondensed-Regular.woff2");
    const expected = decodeWoff2(woff2, brotli);
    const runtime = globalThis as { process?: { getBuiltinModule?: unknown } };
    const saved = runtime.process?.getBuiltinModule;
    if (runtime.process) runtime.process.getBuiltinModule = undefined;
    try {
      expect(await unwrapFont(woff2)).toEqual(expected);
    } finally {
      if (runtime.process) runtime.process.getBuiltinModule = saved;
    }
  });

  test("explains what to do with a WOFF2 file given to the wrong function", () => {
    expect(() => new Font(read("BarlowCondensed-Regular.woff2"))).toThrow(/loadFont\(\)/);
    expect(() => decodeWoff2(readFont("BarlowCondensed-Regular"), brotli)).toThrow(
      /Not a WOFF2 file/,
    );
    expect(() =>
      decodeWoff2(read("BarlowCondensed-Regular.woff2").subarray(0, 30), brotli),
    ).toThrow(/too short/);
  });
});
