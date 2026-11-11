import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { PdfImage } from "../src/core/index.ts";
import { decodeImage, shrinkImage } from "../src/image/index.ts";
import { Document, Image, Page, render } from "../src/index.ts";
import { decodeWebp } from "../src/webp/index.ts";
import { renderPdf } from "./harness/render.ts";

const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./images/${name}`, import.meta.url)));
const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
/** The pixel sizes of the images stored in a PDF, masks included. */
const stored = (pdf: Uint8Array): string[] =>
  [...latin1(pdf).matchAll(/\/Subtype\s*\/Image\s*\/Width (\d+)\s*\/Height (\d+)/g)].map(
    (match) => `${match[1]}×${match[2]}`,
  );

const raw = (width: number, height: number, data: number[], alpha?: number[]): PdfImage => ({
  width,
  height,
  colorSpace: "gray",
  bitsPerComponent: 8,
  data: new Uint8Array(data),
  encoding: "raw",
  ...(alpha ? { alpha: new Uint8Array(alpha) } : {}),
});

describe("shrinkImage", () => {
  test("each new pixel is the average of the ones it covers", () => {
    const image = raw(4, 2, [0, 100, 200, 200, 100, 200, 0, 40]);
    const half = shrinkImage(image, 2, 1);
    expect([half.width, half.height, ...half.data]).toEqual([2, 1, 100, 110]);
  });

  test("a pixel covered in part counts in part", () => {
    // Three pixels onto two: each new pixel is one whole pixel and half of the middle one.
    const image = raw(3, 1, [0, 90, 240]);
    expect([...shrinkImage(image, 2, 1).data]).toEqual([30, 190]);
  });

  test("transparent pixels give no colour", () => {
    const image = raw(2, 1, [200, 0], [255, 0]);
    const one = shrinkImage(image, 1, 1);
    expect([...one.data]).toEqual([200]);
    expect([...(one.alpha as Uint8Array)]).toEqual([128]);
  });

  test("an image is never made larger, and comes back itself when nothing changes", () => {
    const image = raw(2, 1, [1, 2]);
    expect(shrinkImage(image, 5, 5)).toBe(image);
  });

  test("a PNG stored as it came is read back, row filters and palette included", () => {
    for (const name of ["basn2c08", "basn0g08", "basn3p08", "basn3p04", "basn3p01", "f04n2c08"]) {
      const image = decodeImage(read(`pngsuite/${name}.png`));
      expect(image.encoding, name).toBe("png");
      const small = shrinkImage(image, 16, 16);
      expect([small.width, small.height, small.encoding], name).toEqual([16, 16, "raw"]);
      expect(small.colorSpace, name).toBe(image.colorSpace === "gray" ? "gray" : "rgb");
      expect(small.data.length, name).toBe(16 * 16 * (small.colorSpace === "gray" ? 1 : 3));
    }
  });

  test("what cannot be read stays as it is", () => {
    for (const name of ["photo.jpg", "pngsuite/basn0g16.png", "pngsuite/basn0g02.png"]) {
      const image = decodeImage(read(name));
      expect(shrinkImage(image, 4, 4), name).toBe(image);
    }
  });
});

describe("maxImageDpi", () => {
  const photo = decodeWebp(read("webp/lossy-photo.webp"));
  const page = (...children: ReturnType<typeof Image>[]) =>
    Document(Page({ size: [200, 200], margin: 0 }, ...children));

  test("an image with far more pixels than it needs is stored at the resolution asked for", async () => {
    const width = 18; // a quarter of an inch
    const document = page(Image({ src: photo, width }));
    const full = await render(document, { deterministic: true });
    const capped = await render(document, { deterministic: true, maxImageDpi: 144 });
    expect(stored(full)).toEqual([`${photo.width}×${photo.height}`]);
    const [size] = stored(capped);
    expect(size?.startsWith("36×")).toBe(true);
    expect(capped.length).toBeLessThan(full.length / 2);
    expect(await render(document, { deterministic: true, maxImageDpi: 144 })).toEqual(capped);

    // The page looks the same.
    const [before] = await renderPdf("pdfium", full, 2);
    const [after] = await renderPdf("pdfium", capped, 2);
    let total = 0;
    const a = before?.pixels as Uint8Array;
    const b = after?.pixels as Uint8Array;
    for (let i = 0; i < a.length; i++) total += Math.abs((a[i] as number) - (b[i] as number));
    expect(total / a.length).toBeLessThan(0.02);
  });

  test("an image that is about the right size is left alone", async () => {
    const width = (photo.width * 72) / 144 / 1.3;
    const pdf = await render(page(Image({ src: photo, width })), { maxImageDpi: 144 });
    expect(stored(pdf)).toEqual([`${photo.width}×${photo.height}`]);
  });

  test("an image drawn at two sizes is stored once when the larger comes first", async () => {
    const large = Image({ src: photo, width: 72 });
    const small = Image({ src: photo, width: 18 });
    expect(stored(await render(page(large, small), { maxImageDpi: 72 }))).toHaveLength(1);
    expect(stored(await render(page(small, large), { maxImageDpi: 72 }))).toHaveLength(2);
  });

  test("transparency is kept, and a JPEG is not touched", async () => {
    const logo = decodeWebp(read("webp/lossless-alpha.webp"));
    const pdf = await render(page(Image({ src: logo, width: 9 })), { maxImageDpi: 72 });
    const sizes = stored(pdf);
    expect(sizes).toHaveLength(2);
    expect(sizes[0]).toBe(sizes[1]);
    expect(sizes[0]?.startsWith("9×")).toBe(true);

    const jpeg = decodeImage(read("photo.jpg"));
    const kept = await render(page(Image({ src: jpeg, width: 9 })), { maxImageDpi: 72 });
    expect(stored(kept)).toEqual([`${jpeg.width}×${jpeg.height}`]);
  });

  test("the warning about low resolution still speaks of the image as given", async () => {
    const warnings: string[] = [];
    await render(page(Image({ src: photo, width: 36 })), {
      maxImageDpi: 72,
      minImageDpi: 200,
      onWarning: (warning) => warnings.push(warning.code),
    });
    expect(warnings).toEqual([]);
  });
});
