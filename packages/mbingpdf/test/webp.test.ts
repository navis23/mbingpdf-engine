import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PdfDocument } from "../src/core/index.ts";
import { decodeImage, loadImage } from "../src/image/index.ts";
import { Document, Image, Page, render } from "../src/index.ts";
import { decodeWebp, isWebp } from "../src/webp/index.ts";

const folder = new URL("./images/webp/", import.meta.url);
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, folder)));
const expected = JSON.parse(readFileSync(new URL("expected.json", folder), "utf8")) as Record<
  string,
  { size: string; rgba: string }
>;
const hasMagick = spawnSync("magick", ["-list", "format"]).stdout?.toString().includes("WEBP");

/** The decoded image as RGBA, opaque where it has no alpha. */
function rgba(image: ReturnType<typeof decodeWebp>): Uint8Array {
  const out = new Uint8Array(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i++) {
    out.set(image.data.subarray(i * 3, i * 3 + 3), i * 4);
    out[i * 4 + 3] = image.alpha ? (image.alpha[i] as number) : 255;
  }
  return out;
}
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("WebP decoding", () => {
  // Each file's pixels must be exactly what libwebp decodes it to (see make.sh).
  for (const [name, { size, rgba: digest }] of Object.entries(expected)) {
    test(`${name} decodes to libwebp's pixels`, () => {
      const image = decodeWebp(read(`${name}.webp`));
      expect(`${image.width}x${image.height}`).toBe(size);
      expect(sha256(rgba(image))).toBe(digest);
    });
  }

  test("every fixture is listed", () => {
    const files = readdirSync(folder).filter((file) => file.endsWith(".webp"));
    expect(files.length).toBe(Object.keys(expected).length + 1); // and the animation
  });

  test.runIf(hasMagick)("the installed libwebp agrees with the recorded pixels", () => {
    for (const name of Object.keys(expected)) {
      const path = new URL(`${name}.webp`, folder).pathname;
      const reference = spawnSync("magick", [path, "-depth", "8", "rgba:-"], {
        maxBuffer: 1 << 24,
      });
      expect(sha256(new Uint8Array(reference.stdout)), name).toBe(expected[name]?.rgba);
    }
  });

  test("the result has the shape an Image takes", () => {
    const opaque = decodeWebp(read("lossy-photo.webp"));
    expect(opaque).toMatchObject({
      width: 120,
      height: 80,
      colorSpace: "rgb",
      bitsPerComponent: 8,
    });
    expect(opaque.encoding).toBe("raw");
    expect(opaque.data.length).toBe(120 * 80 * 3);
    // Opaque images carry no alpha; transparent ones do.
    expect(opaque.alpha).toBeUndefined();
    expect(decodeWebp(read("lossless-photo.webp")).alpha).toBeUndefined();
    expect(decodeWebp(read("alpha-compressed.webp")).alpha?.length).toBe(50 * 37);
    expect(decodeWebp(read("lossless-alpha.webp")).alpha?.length).toBe(50 * 37);
  });

  test("tells WebP files apart", () => {
    expect(isWebp(read("lossy-dot.webp"))).toBe(true);
    expect(isWebp(new Uint8Array(12))).toBe(false);
    expect(() => decodeWebp(new Uint8Array([1, 2, 3]))).toThrow("Not a WebP file");
  });

  test("refuses animations and damaged files with a reason", () => {
    expect(() => decodeWebp(read("animated.webp"))).toThrow(
      "Animated WebP images are not supported: use a still image",
    );
    for (const name of ["lossy-photo", "lossless-photo", "alpha-compressed"]) {
      const file = read(`${name}.webp`);
      // Cut short, with the RIFF size left as it was.
      expect(() => decodeWebp(file.subarray(0, file.length >> 1)), name).toThrow(
        "The WebP image data is cut short",
      );
    }
    // A RIFF file with no image chunk in it.
    const empty = new Uint8Array([
      ...new TextEncoder().encode("RIFF"),
      4,
      0,
      0,
      0,
      ...new TextEncoder().encode("WEBP"),
    ]);
    expect(() => decodeWebp(empty)).toThrow("The WebP file holds no image");
  });

  test("a damaged lossless stream is refused, not misread", () => {
    const file = read("lossless-best.webp").slice();
    // Flip bits in the middle of the coded data; whatever the damage, the decoder must either
    // throw a WebP error or return an image of the right size.
    for (let at = 40; at < file.length; at += 97) {
      const damaged = file.slice();
      damaged[at] = (damaged[at] as number) ^ 0x5a;
      try {
        const image = decodeWebp(damaged);
        expect(image.data.length).toBe(97 * 61 * 3);
      } catch (error) {
        expect((error as Error).message).toMatch(/WebP/);
      }
    }
  });

  test("loadImage reads WebP on any runtime, and decodeImage says how", async () => {
    const bytes = read("alpha-vertical.webp");
    const loaded = await loadImage(bytes);
    expect(sha256(rgba(loaded))).toBe(expected["alpha-vertical"]?.rgba);
    expect(() => decodeImage(bytes)).toThrow(
      'WebP images are read by `await loadImage(bytes)`, or by `decodeWebp(bytes)` from "mbingpdf/webp"',
    );
  });

  test("a decoded WebP goes into a PDF with its transparency", async () => {
    const doc = new PdfDocument({ xref: "table", compress: false, deterministic: true });
    doc
      .addPage({ size: [200, 200] })
      .content.image(decodeWebp(read("alpha-horizontal.webp")), 0, 0, 120, 80)
      .image(decodeWebp(read("lossy-photo.webp")), 0, 100, 120, 80);
    const out = new TextDecoder("latin1").decode(doc.finish());
    expect(out.match(/\/Subtype\/Image/g)?.length).toBe(3); // two pictures, one soft mask
    expect(out).toContain("/SMask ");
    // And through the document API, from loadImage.
    const pdf = await render(
      Document(
        Page(
          { size: [200, 200] },
          Image({ src: await loadImage(read("alpha-gradient.webp")), width: 64 }),
        ),
      ),
    );
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
