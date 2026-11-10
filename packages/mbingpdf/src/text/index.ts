/**
 * Text: line breaking, grapheme clusters, hyphenation and paragraph layout.
 */
export { graphemeBreaks, graphemes } from "./grapheme.ts";
export {
  createPatternHyphenator,
  type Hyphenator,
  hyphenateEnglish,
  hyphenateIndonesian,
  type PatternHyphenatorOptions,
} from "./hyphenation.ts";
export { type BreakOpportunity, lineBreaks } from "./line-break.ts";
export {
  drawParagraph,
  type FitTextOptions,
  type FitTextResult,
  fitText,
  layoutParagraph,
  type ParagraphLayout,
  type ParagraphOptions,
  type TextAlign,
  type TextFont,
  type TextLine,
  type TextRun,
  type TextStyle,
  type TextTransform,
} from "./paragraph.ts";
export { UNICODE_VERSION } from "./unicode-data.ts";
