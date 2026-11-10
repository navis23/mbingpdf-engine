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
