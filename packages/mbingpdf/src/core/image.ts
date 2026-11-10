import { PdfDict, PdfName, type PdfObject, type PdfRef, PdfStream, PdfString } from "./objects.ts";
import type { PdfWriter } from "./writer.ts";

/**
 * An image ready to be written into a PDF. The decoders in `mbingpdf/image` produce these; the
 * core does not know any image file format.
 */
export interface PdfImage {
  /** Size in pixels, before any {@link orientation} is applied. */
  readonly width: number;
  readonly height: number;
  readonly colorSpace: "gray" | "rgb" | "cmyk" | "indexed";
  readonly bitsPerComponent: 1 | 2 | 4 | 8 | 16;
  /** The sample data, in the encoding named by `encoding`. */
  readonly data: Uint8Array;
  /**
   * How `data` is stored:
   * - `"raw"`: samples row by row, each row padded to a whole byte; the writer compresses it.
   * - `"jpeg"`: a complete JPEG file, embedded without re-encoding.
   * - `"png"`: zlib data with PNG row filters, embedded without re-encoding.
   */
  readonly encoding: "raw" | "jpeg" | "png";
  /** For `"indexed"`: the RGB palette, three bytes per entry. */
  readonly palette?: Uint8Array;
  /** Opacity per pixel, one 8-bit sample each, row by row. Absent for an opaque image. */
  readonly alpha?: Uint8Array;
  /** True for CMYK JPEGs written by Adobe software, which store inverted values. */
  readonly invert?: boolean;
  /**
   * EXIF orientation, 1–8: how the stored pixels must be turned or mirrored to be upright.
   * 1 (or absent) means they already are.
   */
  readonly orientation?: number;
}

const COLOR_SPACES = { gray: "DeviceGray", rgb: "DeviceRGB", cmyk: "DeviceCMYK" } as const;
const COMPONENTS = { gray: 1, rgb: 3, cmyk: 4, indexed: 1 } as const;

/** Writes the image XObject (and its soft mask, if any) and returns its reference. */
export function writeImage(writer: PdfWriter, image: PdfImage): PdfRef {
  let colorSpace: PdfObject;
  if (image.colorSpace === "indexed") {
    const palette = image.palette ?? new Uint8Array(3);
    colorSpace = [
      new PdfName("Indexed"),
      new PdfName("DeviceRGB"),
      palette.length / 3 - 1,
      new PdfString(palette, true),
    ];
  } else {
    colorSpace = new PdfName(COLOR_SPACES[image.colorSpace]);
  }

  let mask: PdfRef | undefined;
  if (image.alpha) {
    mask = writer.add(
      new PdfStream(
        image.alpha,
        new PdfDict({
          Type: new PdfName("XObject"),
          Subtype: new PdfName("Image"),
          Width: image.width,
          Height: image.height,
          ColorSpace: new PdfName("DeviceGray"),
          BitsPerComponent: 8,
        }),
      ),
    );
  }

  const components = COMPONENTS[image.colorSpace];
  const dict = new PdfDict({
    Type: new PdfName("XObject"),
    Subtype: new PdfName("Image"),
    Width: image.width,
    Height: image.height,
    ColorSpace: colorSpace,
    BitsPerComponent: image.bitsPerComponent,
    SMask: mask,
  });
  if (image.encoding === "jpeg") {
    dict.set("Filter", new PdfName("DCTDecode"));
    if (image.invert)
      dict.set(
        "Decode",
        Array.from({ length: components * 2 }, (_v, i) => (i % 2 === 0 ? 1 : 0)),
      );
  } else if (image.encoding === "png") {
    dict.set("Filter", new PdfName("FlateDecode"));
    dict.set(
      "DecodeParms",
      new PdfDict({
        Predictor: 15,
        Colors: components,
        BitsPerComponent: image.bitsPerComponent,
        Columns: image.width,
      }),
    );
  }
  return writer.add(new PdfStream(image.data, dict));
}

/** Width and height of an image as it should appear, with its orientation applied. */
export function orientedSize(image: PdfImage): { width: number; height: number } {
  const turned = (image.orientation ?? 1) >= 5;
  return {
    width: turned ? image.height : image.width,
    height: turned ? image.width : image.height,
  };
}

/**
 * The matrix that maps the unit square an image is drawn in onto an upright picture, for each
 * EXIF orientation. Applied before the matrix that places the image on the page.
 */
export function orientationMatrix(
  orientation: number | undefined,
): readonly [number, number, number, number, number, number] {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, 1, 0]; // mirrored left to right
    case 3:
      return [-1, 0, 0, -1, 1, 1]; // upside down
    case 4:
      return [1, 0, 0, -1, 0, 1]; // mirrored top to bottom
    case 5:
      return [0, -1, -1, 0, 1, 1]; // transposed
    case 6:
      return [0, -1, 1, 0, 0, 1]; // needs a quarter turn clockwise
    case 7:
      return [0, 1, 1, 0, 0, 0]; // transverse
    case 8:
      return [0, 1, -1, 0, 1, 0]; // needs a quarter turn counter-clockwise
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}
