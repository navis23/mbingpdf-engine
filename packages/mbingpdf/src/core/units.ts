/** Converts to PDF points (1/72 inch), the unit used throughout the core. */
export function mm(value: number): number {
  return (value * 72) / 25.4;
}

export function cm(value: number): number {
  return (value * 72) / 2.54;
}

export function inch(value: number): number {
  return value * 72;
}

export type PageSize = readonly [width: number, height: number];

/** Common page sizes in points, portrait. */
export const PageSizes: {
  readonly A3: PageSize;
  readonly A4: PageSize;
  readonly A5: PageSize;
  readonly A6: PageSize;
  readonly Letter: PageSize;
  readonly Legal: PageSize;
} = {
  A3: [mm(297), mm(420)],
  A4: [mm(210), mm(297)],
  A5: [mm(148), mm(210)],
  A6: [mm(105), mm(148)],
  Letter: [612, 792],
  Legal: [612, 1008],
};

/** A rectangle as lower-left and upper-right corners: `[x1, y1, x2, y2]`. */
export type Box = readonly [x1: number, y1: number, x2: number, y2: number];

export interface PrintBoxes {
  /** The full sheet (MediaBox size): trim size plus bleed and margin on every side. */
  size: PageSize;
  trimBox: Box;
  bleedBox: Box;
}

/**
 * Page boxes for a job that will be trimmed after printing.
 *
 * @param trim the finished size
 * @param bleed how far artwork extends past the cut line, typically 3 mm
 * @param margin extra room outside the bleed, for printer's marks
 */
export function printBoxes(trim: PageSize, bleed: number, margin = 0): PrintBoxes {
  const [width, height] = trim;
  if (!(bleed >= 0 && margin >= 0)) throw new RangeError("Bleed and margin cannot be negative");
  const edge = bleed + margin;
  return {
    size: [width + 2 * edge, height + 2 * edge],
    trimBox: [edge, edge, edge + width, edge + height],
    bleedBox: [margin, margin, margin + width + 2 * bleed, margin + height + 2 * bleed],
  };
}
