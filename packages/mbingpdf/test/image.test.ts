import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { orientedSize, PdfDocument, type PdfImage } from "../src/core/index.ts";
import { decodeImage, decodeJpeg, decodePng } from "../src/image/index.ts";
import { renderPdf } from "./harness/render.ts";

const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./images/${name}`, import.meta.url)));
const hasMagick = spawnSync("magick", ["-version"]).status === 0;
const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

/**
 * Decodes an image file with ImageMagick to RGBA on a white background. The sample values are
 * taken as they are stored: PngSuite's files declare a linear gamma, which ImageMagick would
 * otherwise convert, and a PDF viewer does not.
 */
function reference(
  name: string,
  ...operations: string[]
): { width: number; height: number; pixels: Uint8Array } {
  const path = new URL(`./images/${name}`, import.meta.url).pathname;
  const input = [
    "-define",
    "png:ignore-gamma=true",
    path,
    "-set",
    "colorspace",
    "sRGB",
    ...operations,
  ];
  const size = spawnSync("magick", [...input, "-format", "%w %h", "info:"], { encoding: "utf8" });
  const [width, height] = size.stdout.trim().split(" ").map(Number) as [number, number];
  const raw = spawnSync(
    "magick",
    [
      ...input,
      "-background",
      "white",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-depth",
      "8",
      "rgba:-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return { width, height, pixels: new Uint8Array(raw.stdout) };
}

/** Draws an image on a page of its own size and renders it at one pixel per point. */
async function drawn(
  image: PdfImage,
): Promise<{ width: number; height: number; pixels: Uint8Array; pdf: Uint8Array }> {
  const { width, height } = orientedSize(image);
  const doc = new PdfDocument({ deterministic: true });
  doc.addPage({ size: [width, height] }).content.image(image, 0, 0, width, height);
  const pdf = doc.finish();
  const [page] = await renderPdf("pdfium", pdf, 1);
  if (!page) throw new Error("no page rendered");
  return { ...page, pdf };
}

/** Largest difference between two images, per colour channel. */
function difference(a: { pixels: Uint8Array }, b: { pixels: Uint8Array }): number {
  let worst = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    if (i % 4 === 3) continue;
    worst = Math.max(worst, Math.abs((a.pixels[i] as number) - (b.pixels[i] as number)));
  }
  return worst;
}

const suite = readdirSync(new URL("./images/pngsuite/", import.meta.url)).filter((name) =>
  name.endsWith(".png"),
);
const valid = suite.filter((name) => !name.startsWith("x"));
const corrupt = suite.filter((name) => name.startsWith("x"));

describe("PNG", () => {
  test("PngSuite is complete", () => {
    expect(valid.length).toBe(162);
    expect(corrupt.length).toBe(14);
  });

  test.skipIf(!hasMagick)(
    "every valid PngSuite image renders as ImageMagick decodes it",
    async () => {
      const failures: string[] = [];
      for (const name of valid) {
        const image = decodePng(read(`pngsuite/${name}`));
        const expected = reference(`pngsuite/${name}`);
        const actual = await drawn(image);
        if (actual.width !== expected.width || actual.height !== expected.height) {
          failures.push(
            `${name}: size ${actual.width}×${actual.height}, expected ${expected.width}×${expected.height}`,
          );
          continue;
        }
        // 16-bit samples are rounded to 8 bits differently by the two decoders.
        const worst = difference(actual, expected);
        if (worst > 2) failures.push(`${name}: differs by ${worst}`);
      }
      expect(failures).toEqual([]);
    },
  );

  test("corrupt files are rejected with a reason", () => {
    for (const name of corrupt) {
      const bytes = read(`pngsuite/${name}`);
      // Two of the "x" files only have a wrong checksum, which is not verified here.
      if (name === "xcsn0g01.png" || name === "xhdn0g08.png") continue;
      expect(() => decodeImage(bytes), name).toThrow(/PNG|Unsupported image format/);
    }
  });

  test("opaque, non-interlaced images are embedded without re-encoding", () => {
    const image = decodePng(read("pngsuite/basn2c08.png"));
    expect(image).toMatchObject({
      width: 32,
      height: 32,
      colorSpace: "rgb",
      bitsPerComponent: 8,
      encoding: "png",
    });
    expect(image.alpha).toBeUndefined();
    const doc = new PdfDocument({ xref: "table", deterministic: true });
    doc.addPage({ size: [32, 32] }).content.image(image, 0, 0, 32, 32);
    const out = latin1(doc.finish());
    expect(out).toContain("/DecodeParms<</Predictor 15/Colors 3/BitsPerComponent 8/Columns 32>>");
    expect(out).toContain("/ColorSpace/DeviceRGB");
  });

  test("palettes, transparency and interlacing", () => {
    const palette = decodePng(read("pngsuite/basn3p08.png"));
    expect(palette.colorSpace).toBe("indexed");
    expect(palette.palette?.length).toBeGreaterThan(0);
    const alpha = decodePng(read("pngsuite/basn6a08.png"));
    expect(alpha.encoding).toBe("raw");
    expect(alpha.alpha?.length).toBe(32 * 32);
    expect(alpha.data.length).toBe(32 * 32 * 3);
    const interlaced = decodePng(read("pngsuite/basi0g01.png"));
    expect(interlaced).toMatchObject({ encoding: "raw", bitsPerComponent: 1, colorSpace: "gray" });
    expect(interlaced.data.length).toBe(4 * 32);
    const keyed = decodePng(read("pngsuite/tbbn0g04.png"));
    expect(keyed.alpha?.includes(0)).toBe(true);
    expect(keyed.alpha?.includes(255)).toBe(true);
  });
});

/** Inserts an EXIF block with the given orientation after a JPEG's start marker. */
function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  // "Exif\0\0", a little-endian TIFF header, and one directory entry: tag 0x0112, SHORT, 1.
  const exif = [
    0x45,
    0x78,
    0x69,
    0x66,
    0,
    0,
    0x49,
    0x49,
    42,
    0,
    8,
    0,
    0,
    0,
    1,
    0,
    0x12,
    0x01,
    3,
    0,
    1,
    0,
    0,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  const segment = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif];
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2));
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

describe("JPEG", () => {
  test("reads size and colour model, and embeds the file as it is", () => {
    const bytes = read("photo.jpg");
    const image = decodeJpeg(bytes);
    expect(image).toMatchObject({
      width: 120,
      height: 80,
      colorSpace: "rgb",
      bitsPerComponent: 8,
      encoding: "jpeg",
    });
    expect(image.data).toEqual(bytes);
    expect(decodeJpeg(read("photo-gray.jpg")).colorSpace).toBe("gray");
    expect(decodeJpeg(read("photo-progressive.jpg"))).toMatchObject({
      width: 120,
      height: 80,
      colorSpace: "rgb",
    });
    expect(decodeJpeg(read("photo-cmyk.jpg")).colorSpace).toBe("cmyk");

    const doc = new PdfDocument({ xref: "table", deterministic: true });
    doc.addPage({ size: [120, 80] }).content.image(image, 0, 0, 120, 80);
    const pdf = doc.finish();
    expect(latin1(pdf)).toContain("/Filter/DCTDecode");
    // The JPEG bytes appear unchanged in the file.
    expect(latin1(pdf)).toContain(latin1(bytes));
  });

  test.skipIf(!hasMagick).each(["photo.jpg", "photo-progressive.jpg", "photo-gray.jpg"])(
    "%s renders as ImageMagick decodes it",
    async (name) => {
      const actual = await drawn(decodeJpeg(read(name)));
      const expected = reference(name);
      expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
      // JPEG decoders differ slightly in rounding and chroma upsampling.
      expect(difference(actual, expected)).toBeLessThanOrEqual(24);
    },
  );

  test("CMYK JPEGs from Adobe software are un-inverted", () => {
    const image = decodeJpeg(read("photo-cmyk.jpg"));
    const doc = new PdfDocument({ xref: "table", deterministic: true });
    doc.addPage({ size: [120, 80] }).content.image(image, 0, 0, 120, 80);
    const out = latin1(doc.finish());
    expect(out).toContain("/ColorSpace/DeviceCMYK");
    if (image.invert) expect(out).toContain("/Decode[1 0 1 0 1 0 1 0]");
  });

  test.skipIf(!hasMagick).each([
    [2, ["-flop"]],
    [3, ["-rotate", "180"]],
    [4, ["-flip"]],
    [5, ["-transpose"]],
    [6, ["-rotate", "90"]],
    [7, ["-transverse"]],
    [8, ["-rotate", "270"]],
  ] as const)("EXIF orientation %i is applied", async (orientation, operations) => {
    const image = decodeJpeg(withOrientation(read("photo.jpg"), orientation));
    expect(image.orientation).toBe(orientation);
    const turned = orientation >= 5;
    expect(orientedSize(image)).toEqual(
      turned ? { width: 80, height: 120 } : { width: 120, height: 80 },
    );
    const actual = await drawn(image);
    const expected = reference("photo.jpg", ...operations);
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    expect(difference(actual, expected)).toBeLessThanOrEqual(24);
  });

  test("rejects files that are not usable JPEGs", () => {
    expect(() => decodeJpeg(new Uint8Array([1, 2, 3, 4]))).toThrow(/Not a JPEG/);
    expect(() => decodeJpeg(read("photo.jpg").subarray(0, 20))).toThrow(/Malformed JPEG/);
    expect(() => decodeImage(new TextEncoder().encode("GIF89a........"))).toThrow(
      /only JPEG and PNG/,
    );
  });
});

describe("images in a document", () => {
  test("an image drawn many times is stored once", () => {
    const image = decodePng(read("pngsuite/basn6a08.png"));
    const doc = new PdfDocument({ xref: "table", compress: false, deterministic: true });
    for (let page = 0; page < 3; page++) {
      const content = doc.addPage({ size: [100, 100] }).content;
      content.image(image, 0, 0, 32, 32).image(image, 50, 50, 16, 16);
    }
    const out = latin1(doc.finish());
    // One image and one soft mask, however often it is drawn.
    expect(out.match(/\/Subtype\/Image/g)?.length).toBe(2);
    expect(out).toContain("/SMask ");
    expect(out.match(/\/Im1 Do/g)?.length).toBe(6);
    expect(out).toContain("q\n32 0 0 32 0 0 cm\n/Im1 Do\nQ\n");
  });

  test("links are written as annotations", () => {
    const doc = new PdfDocument({ xref: "table", compress: false, deterministic: true });
    const page = doc.addPage({ size: [200, 100] });
    page.addLink(10, 20, 80, 12, "https://example.com/faktur?id=42");
    const out = latin1(doc.finish());
    expect(out).toContain("/Subtype/Link/Rect[10 20 90 32]/Border[0 0 0]");
    expect(out).toContain("/S/URI/URI(https://example.com/faktur?id=42)");
    expect(out).toMatch(/\/Annots\[\d+ 0 R\]/);
  });
});
