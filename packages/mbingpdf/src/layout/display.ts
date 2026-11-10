/**
 * The display list: what to draw on each page, with nothing left to decide. Coordinates are in
 * points from the top-left corner of the page, y growing downward. A backend (PDF, SVG) turns
 * it into output without knowing anything about layout.
 */
import type { Color, PdfImage, PositionedGlyph } from "../core/index.ts";
import type { TextFont } from "../text/index.ts";

export type PathCommand =
  | readonly ["M", number, number]
  | readonly ["L", number, number]
  | readonly ["C", number, number, number, number, number, number]
  | readonly ["Z"];

export interface StrokeStyle {
  readonly color: Color;
  readonly width: number;
  readonly dash?: readonly number[];
  readonly cap?: "butt" | "round" | "square";
  readonly join?: "miter" | "round" | "bevel";
}

export type DisplayItem =
  | {
      readonly type: "path";
      readonly commands: readonly PathCommand[];
      readonly fill?: Color;
      readonly stroke?: StrokeStyle;
    }
  | {
      readonly type: "text";
      /** Start of the baseline. */
      readonly x: number;
      readonly y: number;
      readonly font: TextFont;
      readonly size: number;
      readonly color: Color;
      readonly glyphs: readonly PositionedGlyph[];
      /** What the glyphs stand for. */
      readonly text: string;
    }
  | {
      readonly type: "image";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly image: PdfImage;
      /** Draw only the part inside this rectangle (for images that are cropped to fit). */
      readonly clip?: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
    }
  | {
      readonly type: "link";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      /** A web address, or… */
      readonly url?: string;
      /** …the name of an anchor in this document. */
      readonly target?: string;
    }
  | {
      /** A named place that links within the document point to. */
      readonly type: "anchor";
      readonly id: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      /** A heading, for the document's bookmarks. */
      readonly type: "heading";
      readonly level: number;
      readonly title: string;
      /** The anchor that marks the heading's place. */
      readonly id: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      /** Items drawn together with an opacity, a rotation, or both. */
      readonly type: "group";
      readonly opacity?: number;
      /** Clockwise rotation in degrees about `(cx, cy)`. */
      readonly rotate?: { readonly degrees: number; readonly cx: number; readonly cy: number };
      readonly items: readonly DisplayItem[];
    };

export interface DisplayPage {
  /** The finished (trimmed) size of the page. Coordinates are measured from its corner. */
  readonly width: number;
  readonly height: number;
  readonly items: readonly DisplayItem[];
  /** How far artwork may extend past each edge; items may have coordinates in that band. */
  readonly bleed?: number;
  readonly marks?: { readonly crop: boolean; readonly registration: boolean };
}
