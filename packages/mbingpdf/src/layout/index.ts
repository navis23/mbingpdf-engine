/**
 * The document level: elements, layout with pagination, and rendering.
 */
export { CanvasContext, type CanvasStroke } from "./canvas.ts";
export type { DisplayItem, DisplayPage, PathCommand, StrokeStyle } from "./display.ts";
export {
  Absolute,
  Box,
  Canvas,
  Document,
  Grid,
  Image,
  Link,
  Page,
  PageBreak,
  Row,
  Spacer,
  Span,
  Stack,
  Text,
} from "./elements.ts";
export { LayoutError } from "./engine.ts";
export {
  type DocumentLayout,
  type LayoutWarning,
  layoutDocument,
  type Render,
  type RenderOptions,
  render,
} from "./render.ts";
export type {
  AbsoluteProps,
  Align,
  Border,
  BorderSide,
  BoxProps,
  CanvasProps,
  Child,
  ColorInput,
  DocumentProps,
  Edges,
  GridProps,
  ImageProps,
  Justify,
  LayoutNode,
  Length,
  PageInfo,
  PageProps,
  PageSizeInput,
  RowProps,
  SpacerProps,
  SpanProps,
  StackProps,
  TextElementProps,
  TextProps,
} from "./types.ts";
