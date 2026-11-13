/**
 * Themes: a brand defined once (fonts, colours, text styles) and referred to by name.
 */
import type { Color } from "../core/index.ts";
import type { TextFont } from "../text/index.ts";
import type { TextProps } from "./types.ts";

/** What a variable font offers beyond an ordinary one: its axes, and fonts cut from them. */
interface Variable {
  readonly axes: readonly { readonly tag: string; readonly min: number; readonly max: number }[];
  instance(style: Readonly<Record<string, number>>): TextFont;
}

/** The fonts of one family. */
export interface ThemeFontFamily {
  /**
   * One font per weight, keyed by the weight (400 regular, 700 bold); an `i` after the number
   * marks an italic: `{ 400: regular, "400i": italic, 700: bold }`.
   */
  readonly sources?: Readonly<Record<string, TextFont>>;
  /** A variable font with a weight axis, used for every weight instead of `sources`. */
  readonly variable?: TextFont;
  /** The same, for italics. */
  readonly variableItalic?: TextFont;
  /** Fonts to try for characters the family lacks. */
  readonly fallback?: readonly TextFont[];
}

/**
 * A named text style: any text properties. A colour or font given by name is any string here,
 * not one of the registered theme's names: the theme is what the names come from, so its own
 * type must not depend on them (a theme made in a function could not be registered otherwise).
 * A wrong name is reported when the document is laid out.
 */
export interface ThemeTextStyle extends Omit<TextProps, "style" | "color" | "font"> {
  color?: Color | string;
  font?: TextFont | readonly TextFont[] | string;
}

export interface Theme {
  /** Font families by name. A single font may be given where a family has only one. */
  readonly fonts?: Readonly<Record<string, ThemeFontFamily | TextFont>>;
  /** Colours by name. */
  readonly colors?: Readonly<Record<string, Color | `#${string}`>>;
  /**
   * Text styles by name. `body` is the document's default; `h1` to `h6` are used by `Heading`.
   */
  readonly text?: Readonly<Record<string, ThemeTextStyle>>;
}

/**
 * Declares a theme. It returns what it is given; its purpose is to keep the exact names, so
 * that `style: "h1"`, `color: "brand"` and `font: "body"` can be checked by the compiler:
 *
 * ```ts
 * const theme = defineTheme({ colors: { brand: "#0F62FE" }, text: { h1: { size: 22 } } });
 * declare module "mbingpdf" {
 *   interface Register { theme: typeof theme }
 * }
 * ```
 *
 * A theme whose fonts are loaded at run time is made in a function; register its return type:
 * `interface Register { theme: ReturnType<typeof makeTheme> }`.
 */
export function defineTheme<const T extends Theme>(theme: T): T {
  return theme;
}

/**
 * Extend this interface with `theme: typeof yourTheme` (see {@link defineTheme}) to have the
 * names of your colours, fonts and text styles checked and completed by the editor.
 */
// biome-ignore lint/suspicious/noEmptyInterface: meant to be extended by the application
export interface Register {}

type Registered = Register extends { theme: infer T } ? T : Theme;
type NamesOf<K extends keyof Theme> = Registered extends { [P in K]: infer R }
  ? string extends keyof R
    ? string
    : keyof R & string
  : string;

/** The name of a colour in the registered theme (any string when none is registered). */
export type ThemeColorName = NamesOf<"colors">;
/** The name of a font family in the registered theme. */
export type ThemeFontName = NamesOf<"fonts">;
/** The name of a text style in the registered theme. */
export type ThemeTextStyleName = NamesOf<"text">;

const isFamily = (value: ThemeFontFamily | TextFont): value is ThemeFontFamily =>
  !("shape" in value) && ("sources" in value || "variable" in value || "variableItalic" in value);

/** Picks the font of a family for a weight and slant. */
export function resolveThemeFont(
  theme: Theme | undefined,
  family: string,
  weight: number,
  italic: boolean,
): TextFont | readonly TextFont[] {
  const entry = theme?.fonts?.[family];
  if (!entry) {
    const known = Object.keys(theme?.fonts ?? {});
    throw new RangeError(
      known.length > 0
        ? `Unknown font "${family}". The theme has: ${known.join(", ")}.`
        : `Unknown font "${family}": fonts given by name need a theme with a \`fonts\` entry.`,
    );
  }
  if (!isFamily(entry)) return entry;

  let chosen: TextFont | undefined;
  const variable = (italic ? entry.variableItalic : undefined) ?? entry.variable;
  if (variable) {
    const cuttable = variable as unknown as Partial<Variable>;
    const axis = cuttable.axes?.find((candidate) => candidate.tag === "wght");
    chosen =
      axis && cuttable.instance
        ? cuttable.instance({ wght: Math.min(Math.max(weight, axis.min), axis.max) })
        : variable;
  } else {
    // The nearest weight of the right slant; failing that, the nearest of the other.
    const candidates = Object.entries(entry.sources ?? {}).map(([key, font]) => ({
      weight: Number.parseInt(key, 10),
      italic: key.endsWith("i"),
      font,
    }));
    const pool = candidates.some((candidate) => candidate.italic === italic)
      ? candidates.filter((candidate) => candidate.italic === italic)
      : candidates;
    pool.sort(
      (a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || b.weight - a.weight,
    );
    chosen = pool[0]?.font;
  }
  if (!chosen) throw new RangeError(`The font family "${family}" has no fonts`);
  return entry.fallback && entry.fallback.length > 0 ? [chosen, ...entry.fallback] : chosen;
}
