/** A device colour. Every component runs from 0 to 1. */
export type Color =
  | { readonly space: "gray"; readonly gray: number }
  | { readonly space: "rgb"; readonly r: number; readonly g: number; readonly b: number }
  | {
      readonly space: "cmyk";
      readonly c: number;
      readonly m: number;
      readonly y: number;
      readonly k: number;
    }
  | {
      /** A spot colour: an ink of its own on press, such as a Pantone colour or a varnish. */
      readonly space: "spot";
      /** The ink's name, exactly as the printer knows it. */
      readonly name: string;
      /** The process colour to show on screens and to print where the ink is not available. */
      readonly alternate: Extract<Color, { space: "cmyk" }>;
      /** How much of the ink to lay down, from 0 (none) to 1 (solid). */
      readonly tint: number;
    };

function unit(value: number, label: string): number {
  if (!(value >= 0 && value <= 1)) {
    throw new RangeError(`Colour component ${label} must be between 0 and 1, got ${value}`);
  }
  return value;
}

/** DeviceGray: 0 is black, 1 is white. */
export function gray(value: number): Color {
  return { space: "gray", gray: unit(value, "gray") };
}

/** DeviceRGB, components 0–1. */
export function rgb(r: number, g: number, b: number): Color {
  return { space: "rgb", r: unit(r, "r"), g: unit(g, "g"), b: unit(b, "b") };
}

/** DeviceCMYK, components 0–1 (ink coverage). */
export function cmyk(c: number, m: number, y: number, k: number): Color {
  return { space: "cmyk", c: unit(c, "c"), m: unit(m, "m"), y: unit(y, "y"), k: unit(k, "k") };
}

/** DeviceRGB from `#rgb` or `#rrggbb`. */
export function hex(value: string): Color {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) throw new RangeError(`Not a hex colour: ${value}`);
  let digits = match[1] as string;
  if (digits.length === 3) digits = digits.replace(/./g, "$&$&");
  const channel = (at: number): number => Number.parseInt(digits.slice(at, at + 2), 16) / 255;
  return rgb(channel(0), channel(2), channel(4));
}

/**
 * A spot colour: `spot("PANTONE 286 C", cmyk(1, 0.75, 0, 0.02))`. The CMYK value is what
 * screens and presses without the ink show instead.
 */
export function spot(name: string, alternate: Color, tint = 1): Color {
  if (alternate.space !== "cmyk")
    throw new RangeError("The alternate of a spot colour must be a cmyk() colour");
  if (name.trim() === "") throw new RangeError("A spot colour needs the name of its ink");
  return { space: "spot", name, alternate, tint: unit(tint, "tint") };
}
