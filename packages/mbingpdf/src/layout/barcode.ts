/** The `Barcode` element: a one-dimensional barcode drawn as vector bars. */
import { type BarcodeType, barcode } from "../barcode/index.ts";
import type { BoxProps, ColorInput, LayoutNode } from "./types.ts";

export interface BarcodeProps extends BoxProps {
  /** What to encode. Which characters and lengths are allowed depends on `type`. */
  value: string;
  /**
   * The kind of barcode. Default `"code128"`, which takes any ASCII text. The others:
   * `"ean13"`, `"ean8"`, `"upca"` (retail), `"code39"`, `"itf"` and `"itf14"` (cartons).
   */
  type?: BarcodeType;
  /**
   * Width of the narrowest bar in points. Default 1, about a third of a millimetre, which
   * office printers and phone cameras both manage. Scanners need 0.75 or more.
   */
  moduleWidth?: number;
  /** Height of the bars in points. Default 36. */
  barHeight?: number;
  /** Print the value under the bars. Default true. */
  showText?: boolean;
  /** Size of that text. Default 8. */
  textSize?: number;
  /**
   * Width of the empty margin scanners need on either side, in modules. Default 10; set 0
   * when the layout already leaves that much white around the code.
   */
  quiet?: number;
  /** Colour of the bars. Default: the text colour. Keep it dark on a light ground. */
  color?: ColorInput;
}

/**
 * A barcode, drawn as vector shapes so that it prints sharply. The value is checked when the
 * element is made: a value the code cannot hold is an error there, not a silent bad print.
 */
export function Barcode(props: BarcodeProps): LayoutNode<"Canvas"> {
  const {
    value,
    type = "code128",
    moduleWidth = 1,
    barHeight = 36,
    showText = true,
    textSize = 8,
    quiet = 10,
    color,
    ...box
  } = props;
  const code = barcode(type, value);
  const margin = Math.max(0, quiet) * moduleWidth;
  const gap = textSize * 0.25;
  const height = barHeight + (showText ? gap + textSize : 0);
  return {
    type: "Canvas",
    props: {
      // For screen readers the code is its value.
      alt: `Barcode: ${code.text}`,
      ...box,
      width: code.modules.length * moduleWidth + margin * 2,
      height,
      draw: (g) => {
        // Neighbouring dark modules become one bar.
        for (let i = 0; i < code.modules.length; i++) {
          if (!code.modules[i]) continue;
          let end = i;
          while (code.modules[end + 1]) end++;
          g.rect(margin + i * moduleWidth, 0, (end - i + 1) * moduleWidth, barHeight);
          i = end;
        }
        if (color === undefined) g.fill();
        else g.fill(color);
        if (showText) {
          g.text(code.text, margin + (code.modules.length * moduleWidth) / 2, barHeight + gap, {
            size: textSize,
            align: "center",
            baseline: "top",
            ...(color === undefined ? {} : { color }),
          });
        }
      },
    },
    children: [],
  };
}
