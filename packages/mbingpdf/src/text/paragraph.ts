/**
 * Paragraph layout: breaking text into lines that fit a width, then aligning them.
 *
 * This is the single-style building block. Paragraphs that mix fonts, sizes and colours are
 * laid out by the layout engine on top of the same pieces.
 */
import type { AnyFont, ContentStream, PositionedGlyph } from "../core/index.ts";
import { graphemeBreaks } from "./grapheme.ts";
import type { Hyphenator } from "./hyphenation.ts";
import { lineBreaks } from "./line-break.ts";

/** A font the text layout can measure with: any standard font or parsed font file. */
export type TextFont = AnyFont & {
  readonly lineGap: number;
  hasGlyphsFor(text: string): boolean;
  shape(
    text: string,
    options?: { readonly features?: Readonly<Record<string, boolean | number>> },
  ): readonly PositionedGlyph[];
};

export type TextAlign = "left" | "center" | "right" | "justify";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";

export interface TextStyle {
  /**
   * The font, or a list to fall back through: each character is drawn with the first font
   * that has a glyph for it.
   */
  font: TextFont | readonly TextFont[];
  /** Font size in points. */
  size: number;
  /** Extra space after each character, in points. Negative values tighten. */
  letterSpacing?: number;
  /** Extra space after each word space, in points. */
  wordSpacing?: number;
  /** OpenType features to switch on or off: `{ tnum: true, liga: false }`. */
  features?: Readonly<Record<string, boolean | number>>;
  transform?: TextTransform;
}

export interface ParagraphOptions extends TextStyle {
  /** The width lines must fit in, in points. Omit for no wrapping. */
  width?: number;
  /** Default `"left"`. `"justify"` stretches word spaces on every line but the last. */
  align?: TextAlign;
  /**
   * Distance between baselines as a multiple of the font size, such as 1.4. By default the
   * font's own line spacing is used.
   */
  lineHeight?: number;
  /** Splits long words at line ends, for example {@link hyphenateIndonesian}. */
  hyphenate?: Hyphenator;
}

/** A stretch of glyphs in one font. */
export interface TextRun {
  readonly font: TextFont;
  readonly glyphs: readonly PositionedGlyph[];
  /** What the glyphs stand for; glyph clusters are offsets into it. */
  readonly text: string;
  /** Distance from the left edge of the paragraph to the start of the run. */
  readonly x: number;
  readonly width: number;
}

export interface TextLine {
  readonly runs: readonly TextRun[];
  readonly text: string;
  /** Distance from the left edge of the paragraph to the start of the line. */
  readonly x: number;
  /** Width of the ink-bearing part of the line; trailing spaces are not counted. */
  readonly width: number;
  /** Distance from the top of the paragraph to the top of the line box. */
  readonly top: number;
  readonly height: number;
  /** Distance from the top of the paragraph to the baseline. */
  readonly baseline: number;
  /** True when the line ends in a hyphen the layout added. */
  readonly hyphenated: boolean;
}

export interface ParagraphLayout {
  readonly lines: readonly TextLine[];
  /** The width given, or the width of the longest line when none was. */
  readonly width: number;
  readonly height: number;
  readonly size: number;
  /** Characters that none of the fonts could show; they are drawn as "missing" boxes. */
  readonly missingCharacters: readonly string[];
}

interface Opportunity {
  offset: number;
  mandatory: boolean;
  hyphen: boolean;
}

const WORD = /\p{L}[\p{L}\p{M}]*/gu;
const isLineSpace = (char: string): boolean => char === " " || char === "\t" || char === "　";
const isHardBreak = (char: string): boolean =>
  char === "\n" ||
  char === "\r" ||
  char === " " ||
  char === " " ||
  char === "\u0085" ||
  char === "\u000b" ||
  char === "\u000c";
const isWordSpace = (char: string): boolean => char === " " || char === " ";

function applyTransform(text: string, transform: TextTransform | undefined): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") {
    return text.replace(WORD, (word) => {
      const first = String.fromCodePoint(word.codePointAt(0) as number);
      return first.toUpperCase() + word.slice(first.length);
    });
  }
  return text;
}

/** Splits text into stretches that one font of the chain can show. */
function itemize(
  text: string,
  fonts: readonly TextFont[],
  missing: Set<string>,
): { font: TextFont; start: number; end: number }[] {
  const primary = fonts[0] as TextFont;
  const items: { font: TextFont; start: number; end: number }[] = [];
  let start = 0;
  let current: TextFont | undefined;
  let position = 0;
  for (const end of graphemeBreaks(text)) {
    const cluster = text.slice(position, end);
    let font: TextFont | undefined;
    // Stay in the current font when it can show the cluster; spaces and punctuation then
    // do not bounce between fonts.
    if (current?.hasGlyphsFor(cluster)) font = current;
    else font = fonts.find((candidate) => candidate.hasGlyphsFor(cluster));
    if (!font) {
      // Line and paragraph separators have no glyph and are not "missing".
      if (cluster.trim() !== "") missing.add(cluster);
      font = current ?? primary;
    }
    if (font !== current) {
      if (current && position > start) items.push({ font: current, start, end: position });
      start = position;
      current = font;
    }
    position = end;
  }
  if (current && position > start) items.push({ font: current, start, end: position });
  return items;
}

/** Shapes one stretch and applies letter and word spacing. Positions stay in font units. */
function shapeRun(
  font: TextFont,
  text: string,
  style: TextStyle,
  lastOfLine: boolean,
): PositionedGlyph[] {
  const letterSpacing = style.letterSpacing ?? 0;
  const wordSpacing = style.wordSpacing ?? 0;
  // Ligatures would swallow the space that letter spacing asks for.
  const features =
    letterSpacing !== 0 ? { liga: false, clig: false, ...style.features } : style.features;
  const shaped = font.shape(text, features ? { features } : undefined);
  if (letterSpacing === 0 && wordSpacing === 0) return [...shaped];
  const perPoint = font.unitsPerEm / style.size;
  return shaped.map((glyph, i) => {
    const endsCluster = shaped[i + 1]?.cluster !== glyph.cluster;
    if (!endsCluster) return glyph;
    let extra = 0;
    if (!(lastOfLine && i === shaped.length - 1)) extra += letterSpacing;
    if (isWordSpace(text.charAt(glyph.cluster))) extra += wordSpacing;
    return extra === 0 ? glyph : { ...glyph, xAdvance: glyph.xAdvance + extra * perPoint };
  });
}

const runWidth = (font: TextFont, glyphs: readonly PositionedGlyph[], size: number): number => {
  let total = 0;
  for (const glyph of glyphs) total += glyph.xAdvance;
  return (total * size) / font.unitsPerEm;
};

/** Lays out text as a paragraph. Line feeds in the text start new lines. */
export function layoutParagraph(source: string, options: ParagraphOptions): ParagraphLayout {
  const { size } = options;
  if (!(size > 0)) throw new RangeError("Font size must be positive");
  const fonts = Array.isArray(options.font)
    ? (options.font as readonly TextFont[])
    : [options.font as TextFont];
  const primary = fonts[0];
  if (!primary) throw new RangeError("At least one font is required");
  const maxWidth = options.width ?? Number.POSITIVE_INFINITY;
  if (!(maxWidth > 0)) throw new RangeError("Paragraph width must be positive");
  const align = options.align ?? "left";
  const text = applyTransform(source, options.transform);
  const missing = new Set<string>();

  // Measure the whole text once: `prefix[i]` is the width of everything before offset i.
  const advances = new Float64Array(text.length + 1);
  for (const item of itemize(text, fonts, missing)) {
    const slice = text.slice(item.start, item.end);
    const glyphs = shapeRun(item.font, slice, options, false);
    for (const glyph of glyphs) {
      const at = item.start + glyph.cluster;
      advances[at] = (advances[at] as number) + (glyph.xAdvance * size) / item.font.unitsPerEm;
    }
  }
  const prefix = new Float64Array(text.length + 1);
  for (let i = 0; i < text.length; i++)
    prefix[i + 1] = (prefix[i] as number) + (advances[i] as number);
  const widthOf = (start: number, end: number): number =>
    (prefix[end] as number) - (prefix[start] as number);

  // Where lines may end: the Unicode rules, plus hyphenation points inside words.
  const opportunities: Opportunity[] = lineBreaks(text).map(({ offset, mandatory }) => ({
    offset,
    mandatory,
    hyphen: text.charAt(offset - 1) === "­",
  }));
  if (options.hyphenate && Number.isFinite(maxWidth)) {
    for (const match of text.matchAll(WORD)) {
      for (const point of options.hyphenate(match[0])) {
        opportunities.push({ offset: match.index + point, mandatory: false, hyphen: true });
      }
    }
    opportunities.sort((a, b) => a.offset - b.offset || Number(b.mandatory) - Number(a.mandatory));
  }

  const hyphenFont = fonts.find((font) => font.hasGlyphsFor("-")) ?? primary;
  const hyphenWidth = runWidth(hyphenFont, hyphenFont.shape("-"), size);
  /** The end of a line's visible text: spaces and the line break itself hang off the end. */
  const trimEnd = (start: number, end: number): number => {
    let at = end;
    while (at > start && (isLineSpace(text.charAt(at - 1)) || isHardBreak(text.charAt(at - 1))))
      at--;
    return at;
  };

  // Greedy line filling: take as many break opportunities as fit.
  const pieces: { start: number; end: number; hyphen: boolean; last: boolean }[] = [];
  const tolerance = 1e-6;
  let start = 0;
  let next = 0;
  while (start < text.length) {
    let best = -1;
    for (let j = next; j < opportunities.length; j++) {
      const opportunity = opportunities[j] as Opportunity;
      const width =
        widthOf(start, trimEnd(start, opportunity.offset)) + (opportunity.hyphen ? hyphenWidth : 0);
      if (width > maxWidth + tolerance) break;
      best = j;
      if (opportunity.mandatory) break;
    }
    if (best < 0) {
      // Not even the first piece fits: split it between characters, keeping at least one.
      const limit = (opportunities[next] as Opportunity).offset;
      let end = start;
      for (const boundary of graphemeBreaks(text.slice(start, limit))) {
        if (end > start && widthOf(start, start + boundary) > maxWidth + tolerance) break;
        end = start + boundary;
      }
      const whole = end === limit;
      const opportunity = opportunities[next] as Opportunity;
      pieces.push({
        start,
        end: whole ? trimEnd(start, end) : end,
        hyphen: whole && opportunity.hyphen,
        last: whole && opportunity.mandatory,
      });
      start = end;
      if (whole) next++;
      continue;
    }
    const opportunity = opportunities[best] as Opportunity;
    pieces.push({
      start,
      end: trimEnd(start, opportunity.offset),
      hyphen: opportunity.hyphen && !opportunity.mandatory,
      last: opportunity.mandatory,
    });
    start = opportunity.offset;
    next = best + 1;
  }

  // Build each line: shape its final text (so kerning at the line's edges is right), then align.
  const lines: TextLine[] = [];
  let top = 0;
  let longest = 0;
  const metricsOf = (font: TextFont): { ascent: number; descent: number; gap: number } => ({
    ascent: (font.ascender * size) / font.unitsPerEm,
    descent: (-font.descender * size) / font.unitsPerEm,
    gap: (font.lineGap * size) / font.unitsPerEm,
  });
  for (const piece of pieces) {
    const lineText = text.slice(piece.start, piece.end) + (piece.hyphen ? "-" : "");
    const items = itemize(lineText, fonts, missing);
    const shaped = items.map((item, i) => {
      const runText = lineText.slice(item.start, item.end);
      return {
        font: item.font,
        text: runText,
        glyphs: shapeRun(item.font, runText, options, i === items.length - 1),
      };
    });
    let width = 0;
    for (const run of shaped) width += runWidth(run.font, run.glyphs, size);

    let x = 0;
    if (Number.isFinite(maxWidth)) {
      const slack = maxWidth - width;
      if (align === "center") x = slack / 2;
      else if (align === "right") x = slack;
      else if (align === "justify" && !piece.last && slack > 0) {
        // Stretch the word spaces to fill the line.
        let spaces = 0;
        for (const run of shaped) {
          for (const glyph of run.glyphs) {
            if (isWordSpace(run.text.charAt(glyph.cluster))) spaces++;
          }
        }
        if (spaces > 0) {
          const extra = slack / spaces;
          for (const run of shaped) {
            const perPoint = run.font.unitsPerEm / size;
            run.glyphs = run.glyphs.map((glyph) =>
              isWordSpace(run.text.charAt(glyph.cluster))
                ? { ...glyph, xAdvance: glyph.xAdvance + extra * perPoint }
                : glyph,
            );
          }
          width = maxWidth;
        }
      }
    }

    const used =
      shaped.length > 0 ? shaped.map((run) => metricsOf(run.font)) : [metricsOf(primary)];
    const ascent = Math.max(...used.map((metrics) => metrics.ascent));
    const descent = Math.max(...used.map((metrics) => metrics.descent));
    const height =
      options.lineHeight !== undefined
        ? options.lineHeight * size
        : Math.max(...used.map((metrics) => metrics.ascent + metrics.descent + metrics.gap));
    // Extra line spacing is shared equally above and below the text ("half-leading").
    const baseline = top + (height - (ascent + descent)) / 2 + ascent;

    const runs: TextRun[] = [];
    let runX = x;
    for (const run of shaped) {
      const widthOfRun = runWidth(run.font, run.glyphs, size);
      runs.push({ font: run.font, glyphs: run.glyphs, text: run.text, x: runX, width: widthOfRun });
      runX += widthOfRun;
    }
    lines.push({ runs, text: lineText, x, width, top, height, baseline, hyphenated: piece.hyphen });
    longest = Math.max(longest, width);
    top += height;
  }

  return {
    lines,
    width: Number.isFinite(maxWidth) ? maxWidth : longest,
    height: top,
    size,
    missingCharacters: [...missing],
  };
}

/**
 * Draws a laid-out paragraph with its top-left corner at `(x, top)`, in the content stream's
 * coordinates (y grows upward, so lines run downward from `top`). Set the fill colour first.
 */
export function drawParagraph(
  content: ContentStream,
  layout: ParagraphLayout,
  x: number,
  top: number,
): void {
  for (const line of layout.lines) {
    for (const run of line.runs) {
      if (run.glyphs.length === 0) continue;
      content
        .font(run.font, layout.size)
        .beginText()
        .moveText(x + run.x, top - line.baseline)
        .showGlyphs(run.glyphs, run.text)
        .endText();
    }
  }
}

export interface FitTextOptions extends TextStyle {
  /** The width the text must fit in, in points. */
  width: number;
  /** The size to use when the text fits; it is never made larger than this. */
  maxSize: number;
  /** The smallest acceptable size. Default: a tenth of `maxSize`. */
  minSize?: number;
}

export interface FitTextResult {
  /** The largest size from `minSize` to `maxSize` at which the text fits on one line. */
  readonly size: number;
  /** Width of the text at that size. */
  readonly width: number;
  /** False when the text is still too wide at `minSize`. */
  readonly fits: boolean;
}

/**
 * Finds the font size at which text fills, but does not exceed, a width: a long name on a
 * certificate, a number on a race bib. Pass the result's `size` to {@link layoutParagraph}.
 */
export function fitText(
  text: string,
  options: Omit<FitTextOptions, "size"> & { size?: never },
): FitTextResult {
  const { width, maxSize } = options;
  const minSize = options.minSize ?? maxSize / 10;
  if (!(width > 0 && maxSize > 0 && minSize > 0 && minSize <= maxSize)) {
    throw new RangeError("fitText needs a positive width and 0 < minSize <= maxSize");
  }
  const style = { ...options } as Record<string, unknown>;
  delete style.width;
  delete style.maxSize;
  delete style.minSize;
  const measure = (size: number, spacing: boolean): number =>
    layoutParagraph(text, {
      ...(style as unknown as TextStyle),
      size,
      ...(spacing ? {} : { letterSpacing: 0, wordSpacing: 0 }),
    }).width;

  const natural = measure(maxSize, true);
  if (natural <= width) return { size: maxSize, width: natural, fits: true };
  // Glyph widths scale with the size; letter and word spacing are fixed amounts.
  const scalable = measure(maxSize, false);
  const fixed = natural - scalable;
  const size = Math.max(minSize, Math.min(maxSize, ((width - fixed) * maxSize) / scalable));
  const fitted = measure(size, true);
  return { size, width: fitted, fits: fitted <= width + 1e-6 };
}
