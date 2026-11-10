/**
 * A small chart kit: bar, line and pie charts, each a `Canvas` that draws itself. They are
 * vector drawings in the document's own fonts, sized by the layout like any other element.
 */
import type { Color } from "../core/index.ts";
import type { CanvasContext } from "./canvas.ts";
import { toColor } from "./style.ts";
import type { BoxProps, ColorInput, LayoutNode, Length } from "./types.ts";

/** One line or one set of bars. */
export interface ChartSeries {
  /** Shown in the legend. */
  name?: string;
  /** One value per label; `null` leaves a gap. */
  values: readonly (number | null)[];
  /** Default: the next colour of the chart's palette. */
  color?: ColorInput;
}

interface ChartProps extends BoxProps {
  /** Default `"100%"`: as wide as the container. */
  width?: Length;
  /** Height in points. Default 180. */
  height?: number;
  /** A title above the chart. */
  title?: string;
  /** The colours series take in turn. The default palette stays distinct for colour-blind readers. */
  colors?: readonly ColorInput[];
  /** Show a key to the colours. Default: when there is more than one series. */
  legend?: boolean;
  /** Size of labels in points. Default 8. */
  labelSize?: number;
  /** How to write a value: `(value) => \`Rp ${value}\``. Default: the number, at most two decimals. */
  format?: (value: number) => string;
}

interface AxisChartProps extends ChartProps {
  /** One label per position along the axis. */
  labels: readonly string[];
  /** The data: several series, or `values` for just one. */
  series?: readonly ChartSeries[];
  /** The values of a single series. */
  values?: readonly (number | null)[];
  /** The value axis starts here. Default: zero, or lower if the data goes below it. */
  min?: number;
  /** The value axis ends here. Default: a round number above the largest value. */
  max?: number;
  /** Draw a faint line across the chart at each tick of the value axis. Default true. */
  grid?: boolean;
  /** Write each value next to its bar or point. Default false. */
  valueLabels?: boolean;
}

export interface BarChartProps extends AxisChartProps {
  /** Put the series on top of one another instead of side by side. */
  stacked?: boolean;
  /** Bars run left to right, with the labels down the side: good for long labels. */
  horizontal?: boolean;
}

export interface LineChartProps extends AxisChartProps {
  /** Shade the area under each line. */
  area?: boolean;
  /** Mark each value with a dot. Default true. */
  points?: boolean;
  /** Join the values with curves instead of straight lines. */
  smooth?: boolean;
}

export interface PieSlice {
  label: string;
  value: number;
  color?: ColorInput;
}

export interface PieChartProps extends ChartProps {
  /** The slices, drawn clockwise from the top. Values must not be negative. */
  data: readonly PieSlice[];
  /** Leave a hole in the middle: true, or the hole's share of the radius (default 0.6). */
  donut?: boolean | number;
  /** What to write on each slice: its share (default), its value, or nothing. */
  valueLabels?: "percent" | "value" | false;
}

/** Okabe and Ito's palette, chosen to stay distinguishable with any colour vision. */
const PALETTE: readonly ColorInput[] = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#D55E00",
  "#CC79A7",
  "#56B4E9",
  "#F0E442",
  "#999999",
];
const GRID = "#E5E7EB";
const AXIS = "#9CA3AF";

const defaultFormat = (value: number): string => String(Math.round(value * 100) / 100);

/** A colour mixed with white: `amount` 0 is white, 1 the colour itself. */
function tint(color: Color, amount: number): Color {
  switch (color.space) {
    case "rgb":
      return {
        space: "rgb",
        r: 1 - (1 - color.r) * amount,
        g: 1 - (1 - color.g) * amount,
        b: 1 - (1 - color.b) * amount,
      };
    case "gray":
      return { space: "gray", gray: 1 - (1 - color.gray) * amount };
    case "cmyk":
      return {
        space: "cmyk",
        c: color.c * amount,
        m: color.m * amount,
        y: color.y * amount,
        k: color.k * amount,
      };
    case "spot":
      return { ...color, tint: color.tint * amount };
  }
}

/** Whether white text reads better than black on a colour. */
function isDark(color: Color): boolean {
  const light =
    color.space === "rgb"
      ? 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
      : color.space === "gray"
        ? color.gray
        : color.space === "cmyk"
          ? (1 - color.k) * (1 - (0.3 * color.c + 0.6 * color.m + 0.1 * color.y))
          : 1 - color.tint * 0.7;
  return light < 0.55;
}

/**
 * Round numbers to label an axis with: about `count` steps of 1, 2 or 5 times a power of ten
 * that cover `min` to `max`.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const rough = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  const ticks: number[] = [];
  const first = Math.floor(min / step + 1e-9);
  const last = Math.ceil(max / step - 1e-9);
  // Multiplying whole numbers by the step keeps 0.1 + 0.2 out of the labels.
  for (let i = first; i <= last; i++) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Draws the title and the legend, and returns the room left between them. */
function furnish(
  g: CanvasContext,
  size: { width: number; height: number },
  props: ChartProps,
  entries: readonly { name: string; color: Color }[],
): Frame {
  const labelSize = props.labelSize ?? 8;
  let top = 0;
  if (props.title) {
    const titleSize = labelSize * 1.4;
    g.text(props.title, size.width / 2, 0, { size: titleSize, align: "center", baseline: "top" });
    top = titleSize * 1.6;
  }
  let bottom = size.height;
  if (entries.length > 0) {
    // The key runs along the bottom, centred, on as many lines as it needs.
    const swatch = labelSize * 0.9;
    const widths = entries.map(
      (entry) => swatch + 4 + g.measureText(entry.name, { size: labelSize }) + labelSize * 1.5,
    );
    const lines: number[][] = [[]];
    let used = 0;
    widths.forEach((width, i) => {
      if (used + width > size.width && (lines.at(-1) as number[]).length > 0) {
        lines.push([]);
        used = 0;
      }
      (lines.at(-1) as number[]).push(i);
      used += width;
    });
    const lineHeight = labelSize * 1.6;
    bottom -= lines.length * lineHeight;
    lines.forEach((line, row) => {
      const total = line.reduce((sum, i) => sum + (widths[i] as number), 0) - labelSize * 1.5;
      let x = (size.width - total) / 2;
      const y = bottom + row * lineHeight + lineHeight / 2 + 2;
      for (const i of line) {
        const entry = entries[i] as (typeof entries)[number];
        g.rect(x, y - swatch / 2, swatch, swatch).fill(entry.color);
        g.text(entry.name, x + swatch + 4, y, { size: labelSize, baseline: "middle" });
        x += widths[i] as number;
      }
    });
    bottom -= 4;
  }
  return { left: 0, top, width: size.width, height: Math.max(0, bottom - top) };
}

/** A series with its defaults filled in. Its colour may still be a name from the theme. */
interface NamedSeries {
  name: string;
  values: readonly (number | null)[];
  color: ColorInput;
}

interface ResolvedSeries extends NamedSeries {
  color: Color;
}

/**
 * Colours are looked up when the chart is drawn, not when it is made: only then is the
 * document's theme known.
 */
function paint<T extends { color: ColorInput }>(entries: readonly T[]): (T & { color: Color })[] {
  return entries.map((entry) => ({ ...entry, color: toColor(entry.color) }));
}

function resolveSeries(props: AxisChartProps): NamedSeries[] {
  const given = props.series ?? (props.values ? [{ values: props.values }] : []);
  if (given.length === 0) throw new RangeError("A chart needs `series` or `values`");
  const palette = props.colors && props.colors.length > 0 ? props.colors : PALETTE;
  return given.map((series, i) => ({
    name: series.name ?? "",
    values: series.values,
    color: series.color ?? (palette[i % palette.length] as ColorInput),
  }));
}

function legendOf(props: ChartProps, series: readonly ResolvedSeries[]): ResolvedSeries[] {
  const named = series.filter((entry) => entry.name !== "");
  return (props.legend ?? series.length > 1) ? named : [];
}

/** The value axis: its range and its ticks. */
function valueScale(
  props: AxisChartProps,
  low: number,
  high: number,
): { min: number; max: number; ticks: number[] } {
  const from = props.min ?? Math.min(0, low);
  let to = props.max ?? Math.max(0, high);
  if (!(to > from)) to = from + 1;
  const ticks = niceTicks(from, to);
  return {
    // A limit that was asked for is kept; one that was worked out is rounded to a tick.
    min: props.min ?? (ticks[0] as number),
    max: props.max ?? (ticks.at(-1) as number),
    ticks,
  };
}

function canvas(
  props: ChartProps,
  kind: string,
  draw: (g: CanvasContext, size: { width: number; height: number }) => void,
): LayoutNode<"Canvas"> {
  const {
    title,
    colors: _colors,
    legend: _legend,
    labelSize: _labelSize,
    format: _format,
    width,
    height,
    ...box
  } = props;
  return {
    type: "Canvas",
    props: {
      alt: title ? `${kind}: ${title}` : kind,
      ...box,
      width: width ?? "100%",
      height: height ?? 180,
      draw,
    },
    children: [],
  };
}

/** Removes the properties that belong to one kind of chart, leaving those every chart shares. */
function shared(props: ChartProps, own: readonly string[]): ChartProps {
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !own.includes(key)),
  ) as ChartProps;
}

const AXIS_PROPS = ["labels", "series", "values", "min", "max", "grid", "valueLabels"];

/**
 * A bar chart: one group of bars per label, one bar per series.
 *
 * ```ts
 * BarChart({ labels: ["Jan", "Feb", "Mar"], values: [12, 19, 7], title: "Orders" })
 * ```
 */
export function BarChart(props: BarChartProps): LayoutNode<"Canvas"> {
  const named = resolveSeries(props);
  const format = props.format ?? defaultFormat;
  const labelSize = props.labelSize ?? 8;
  const count = props.labels.length;
  const value = (entry: NamedSeries, i: number): number => entry.values[i] ?? 0;

  // What the value axis must reach: the tallest bar, or the tallest stack.
  let low = 0;
  let high = 0;
  for (let i = 0; i < count; i++) {
    if (props.stacked) {
      let up = 0;
      let down = 0;
      for (const entry of named) {
        const v = value(entry, i);
        if (v >= 0) up += v;
        else down += v;
      }
      high = Math.max(high, up);
      low = Math.min(low, down);
    } else {
      for (const entry of named) {
        high = Math.max(high, value(entry, i));
        low = Math.min(low, value(entry, i));
      }
    }
  }
  const scale = valueScale(props, low, high);
  const horizontal = props.horizontal === true;

  return canvas(shared(props, [...AXIS_PROPS, "stacked", "horizontal"]), "Bar chart", (g, size) => {
    const series = paint(named);
    const frame = furnish(g, size, props, legendOf(props, series));
    const tickLabels = scale.ticks.map(format);
    const widest = (texts: readonly string[]): number =>
      Math.max(0, ...texts.map((text) => g.measureText(text, { size: labelSize })));
    // Room for the labels of whichever axis runs down the left, and along the bottom.
    const gutter = widest(horizontal ? props.labels : tickLabels) + 6;
    const foot = labelSize * 1.8;
    const plot: Frame = {
      left: frame.left + gutter,
      top: frame.top + labelSize,
      width: Math.max(1, frame.width - gutter - labelSize),
      height: Math.max(1, frame.height - labelSize - foot),
    };
    const along = horizontal ? plot.width : plot.height;
    /** Distance of a value from the axis's start, in points. */
    const at = (v: number): number => ((v - scale.min) / (scale.max - scale.min)) * along;
    const position = (v: number): number =>
      horizontal ? plot.left + at(v) : plot.top + plot.height - at(v);

    scale.ticks.forEach((tick, i) => {
      if (tick < scale.min - 1e-9 || tick > scale.max + 1e-9) return;
      const p = position(tick);
      if (props.grid !== false) {
        if (horizontal) g.line(p, plot.top, p, plot.top + plot.height);
        else g.line(plot.left, p, plot.left + plot.width, p);
        g.stroke({ color: GRID, width: 0.5 });
      }
      if (horizontal) {
        g.text(tickLabels[i] as string, p, plot.top + plot.height + 4, {
          size: labelSize,
          align: "center",
          baseline: "top",
        });
      } else {
        g.text(tickLabels[i] as string, plot.left - 6, p, {
          size: labelSize,
          align: "right",
          baseline: "middle",
        });
      }
    });

    // The line the bars stand on: zero, or the axis's end if zero is out of range.
    const zero = position(Math.max(scale.min, Math.min(scale.max, 0)));
    const band = (horizontal ? plot.height : plot.width) / Math.max(1, count);
    const group = band * 0.7;
    const bars = props.stacked ? 1 : series.length;
    const thickness = group / bars;
    // With many labels and little room, only every second or third is written.
    const widestLabel = widest(props.labels);
    const every = horizontal
      ? Math.max(1, Math.ceil((labelSize * 1.2) / band))
      : Math.max(1, Math.ceil((widestLabel + 4) / band));
    for (let i = 0; i < count; i++) {
      const start = (horizontal ? plot.top : plot.left) + band * i + (band - group) / 2;
      let up = 0;
      let down = 0;
      series.forEach((entry, s) => {
        const raw = entry.values[i];
        if (raw === null || raw === undefined) return;
        let from = 0;
        if (props.stacked) {
          from = raw >= 0 ? up : down;
          if (raw >= 0) up += raw;
          else down += raw;
        }
        const a = position(Math.max(scale.min, Math.min(scale.max, from)));
        const b = position(Math.max(scale.min, Math.min(scale.max, from + raw)));
        const offset = start + (props.stacked ? 0 : s * thickness);
        if (horizontal) g.rect(Math.min(a, b), offset, Math.abs(b - a), thickness);
        else g.rect(offset, Math.min(a, b), thickness, Math.abs(b - a));
        g.fill(entry.color);
        if (props.valueLabels) {
          const text = format(raw);
          if (props.stacked) {
            // Inside the bar, if it is big enough to hold the number.
            const room = Math.abs(b - a);
            const length = g.measureText(text, { size: labelSize }) + 4;
            const fits = horizontal
              ? room > length && thickness > labelSize
              : room > labelSize * 1.4 && thickness > length - 3;
            if (fits) {
              g.text(
                text,
                horizontal ? (a + b) / 2 : offset + thickness / 2,
                horizontal ? offset + thickness / 2 : (a + b) / 2,
                {
                  size: labelSize,
                  align: "center",
                  baseline: "middle",
                  color: isDark(entry.color) ? "#FFFFFF" : "#111827",
                },
              );
            }
          } else if (horizontal) {
            // Past the end of the bar; for a bar below zero, on the far side of the zero line,
            // where it cannot run into the labels of the axis.
            g.text(text, (raw >= 0 ? b : zero) + 3, offset + thickness / 2, {
              size: labelSize,
              baseline: "middle",
            });
          } else {
            g.text(text, offset + thickness / 2, (raw >= 0 ? b : zero) - 3, {
              size: labelSize,
              align: "center",
            });
          }
        }
      });
      if (i % every === 0) {
        const label = props.labels[i] as string;
        if (horizontal) {
          g.text(label, plot.left - 6, start + group / 2, {
            size: labelSize,
            align: "right",
            baseline: "middle",
          });
        } else {
          g.text(label, start + group / 2, plot.top + plot.height + 4, {
            size: labelSize,
            align: "center",
            baseline: "top",
          });
        }
      }
    }

    if (horizontal) g.line(zero, plot.top, zero, plot.top + plot.height);
    else g.line(plot.left, zero, plot.left + plot.width, zero);
    g.stroke({ color: AXIS, width: 0.75 });
  });
}

/**
 * A line chart: one line per series across the labels.
 *
 * ```ts
 * LineChart({ labels: months, series: [{ name: "2025", values: a }, { name: "2026", values: b }] })
 * ```
 */
export function LineChart(props: LineChartProps): LayoutNode<"Canvas"> {
  const named = resolveSeries(props);
  const format = props.format ?? defaultFormat;
  const labelSize = props.labelSize ?? 8;
  const count = props.labels.length;
  const all = named.flatMap((entry) =>
    entry.values.filter((v): v is number => v !== null && v !== undefined),
  );
  const scale = valueScale(props, Math.min(0, ...all), Math.max(0, ...all));

  return canvas(
    shared(props, [...AXIS_PROPS, "area", "points", "smooth"]),
    "Line chart",
    (g, size) => {
      const series = paint(named);
      const frame = furnish(g, size, props, legendOf(props, series));
      const tickLabels = scale.ticks.map(format);
      const gutter =
        Math.max(0, ...tickLabels.map((text) => g.measureText(text, { size: labelSize }))) + 6;
      const foot = labelSize * 1.8;
      const firstLabel = g.measureText(props.labels[0] ?? "", { size: labelSize });
      const lastLabel = g.measureText(props.labels.at(-1) ?? "", { size: labelSize });
      const plot: Frame = {
        // The first and last labels are centred on the ends of the line and need half their width.
        left: frame.left + Math.max(gutter, firstLabel / 2),
        top: frame.top + labelSize,
        width: 1,
        height: Math.max(1, frame.height - labelSize - foot),
      };
      plot.width = Math.max(1, frame.width - plot.left - Math.max(labelSize, lastLabel / 2));
      const x = (i: number): number =>
        plot.left + (count > 1 ? (plot.width * i) / (count - 1) : plot.width / 2);
      const y = (v: number): number =>
        plot.top + plot.height - ((v - scale.min) / (scale.max - scale.min)) * plot.height;

      scale.ticks.forEach((tick, i) => {
        if (tick < scale.min - 1e-9 || tick > scale.max + 1e-9) return;
        if (props.grid !== false) {
          g.line(plot.left, y(tick), plot.left + plot.width, y(tick)).stroke({
            color: GRID,
            width: 0.5,
          });
        }
        g.text(tickLabels[i] as string, plot.left - 6, y(tick), {
          size: labelSize,
          align: "right",
          baseline: "middle",
        });
      });
      const base = y(Math.max(scale.min, Math.min(scale.max, 0)));

      const widestLabel = Math.max(
        0,
        ...props.labels.map((label) => g.measureText(label, { size: labelSize })),
      );
      const spacing = count > 1 ? plot.width / (count - 1) : plot.width;
      const every = Math.max(1, Math.ceil((widestLabel + 6) / spacing));
      props.labels.forEach((label, i) => {
        if (i % every !== 0) return;
        g.text(label, x(i), plot.top + plot.height + 4, {
          size: labelSize,
          align: "center",
          baseline: "top",
        });
      });

      /** The stretches of a series between its gaps, as points. */
      const runs = (entry: ResolvedSeries): [number, number][][] => {
        const result: [number, number][][] = [];
        let current: [number, number][] = [];
        for (let i = 0; i < count; i++) {
          const v = entry.values[i];
          if (v === null || v === undefined) {
            if (current.length > 0) result.push(current);
            current = [];
          } else current.push([x(i), y(v)]);
        }
        if (current.length > 0) result.push(current);
        return result;
      };
      /** Continues the path through the points after the first, straight or curved. */
      const trace = (points: readonly [number, number][]): void => {
        for (let i = 1; i < points.length; i++) {
          const [px, py] = points[i] as [number, number];
          if (!props.smooth) {
            g.lineTo(px, py);
            continue;
          }
          // A Catmull-Rom spline through the points, written as Bézier curves.
          const p0 = points[i - 2] ?? (points[i - 1] as [number, number]);
          const p1 = points[i - 1] as [number, number];
          const p3 = points[i + 1] ?? [px, py];
          g.curveTo(
            p1[0] + (px - p0[0]) / 6,
            p1[1] + (py - p0[1]) / 6,
            px - (p3[0] - p1[0]) / 6,
            py - (p3[1] - p1[1]) / 6,
            px,
            py,
          );
        }
      };

      if (props.area) {
        for (const entry of series) {
          for (const points of runs(entry)) {
            const [firstX, firstY] = points[0] as [number, number];
            g.moveTo(firstX, base).lineTo(firstX, firstY);
            trace(points);
            g.lineTo((points.at(-1) as [number, number])[0], base).closePath();
            g.fill(tint(entry.color, 0.25));
          }
        }
      }
      g.line(plot.left, base, plot.left + plot.width, base).stroke({ color: AXIS, width: 0.75 });
      for (const entry of series) {
        for (const points of runs(entry)) {
          const [firstX, firstY] = points[0] as [number, number];
          g.moveTo(firstX, firstY);
          trace(points);
          g.stroke({ color: entry.color, width: 1.5, join: "round", cap: "round" });
          if (props.points !== false) {
            for (const [px, py] of points) g.circle(px, py, 2);
            g.fill(entry.color);
          }
          if (props.valueLabels) {
            for (let i = 0; i < count; i++) {
              const v = entry.values[i];
              if (v === null || v === undefined) continue;
              g.text(format(v), x(i), y(v) - 5, { size: labelSize, align: "center" });
            }
          }
        }
      }
    },
  );
}

/**
 * A pie chart, or with `donut` a ring.
 *
 * ```ts
 * PieChart({ data: [{ label: "Bus", value: 12 }, { label: "Minibus", value: 5 }] })
 * ```
 */
export function PieChart(props: PieChartProps): LayoutNode<"Canvas"> {
  const format = props.format ?? defaultFormat;
  const labelSize = props.labelSize ?? 8;
  const palette = props.colors && props.colors.length > 0 ? props.colors : PALETTE;
  for (const slice of props.data) {
    if (!(slice.value >= 0)) {
      throw new RangeError(`A pie slice cannot be negative: "${slice.label}" is ${slice.value}`);
    }
  }
  const named = props.data.map((slice, i) => ({
    name: slice.label,
    value: slice.value,
    color: slice.color ?? (palette[i % palette.length] as ColorInput),
  }));
  const total = named.reduce((sum, slice) => sum + slice.value, 0);
  const hole = props.donut === true ? 0.6 : typeof props.donut === "number" ? props.donut : 0;

  return canvas(shared(props, ["data", "donut", "valueLabels"]), "Pie chart", (g, size) => {
    const slices = paint(named);
    const frame = furnish(g, size, props, props.legend === false ? [] : slices);
    const radius = Math.max(1, Math.min(frame.width, frame.height) / 2 - 2);
    const cx = frame.left + frame.width / 2;
    const cy = frame.top + frame.height / 2;
    if (!(total > 0)) return;
    /** A point on a circle; angles are clockwise from twelve o'clock, in turns. */
    const point = (turn: number, r: number): [number, number] => [
      cx + Math.sin(turn * 2 * Math.PI) * r,
      cy - Math.cos(turn * 2 * Math.PI) * r,
    ];
    /** Continues the path along an arc, in pieces of at most a quarter turn. */
    const arc = (from: number, to: number, r: number): void => {
      const pieces = Math.max(1, Math.ceil(Math.abs(to - from) * 4 - 1e-9));
      for (let i = 0; i < pieces; i++) {
        const a = from + ((to - from) * i) / pieces;
        const b = from + ((to - from) * (i + 1)) / pieces;
        // The control points sit on the tangents, this far along them.
        const k = (4 / 3) * Math.tan(((b - a) * 2 * Math.PI) / 4) * r;
        const [ax, ay] = point(a, r);
        const [bx, by] = point(b, r);
        g.curveTo(
          ax + Math.cos(a * 2 * Math.PI) * k,
          ay + Math.sin(a * 2 * Math.PI) * k,
          bx - Math.cos(b * 2 * Math.PI) * k,
          by - Math.sin(b * 2 * Math.PI) * k,
          bx,
          by,
        );
      }
    };
    let turn = 0;
    for (const slice of slices) {
      const share = slice.value / total;
      if (share <= 0) continue;
      const end = turn + share;
      const inner = radius * hole;
      const [sx, sy] = point(turn, radius);
      g.moveTo(sx, sy);
      arc(turn, end, radius);
      if (inner > 0) {
        const [ix, iy] = point(end, inner);
        g.lineTo(ix, iy);
        arc(end, turn, inner);
      } else if (share < 1) g.lineTo(cx, cy);
      g.closePath();
      // A thin white edge keeps neighbouring slices apart.
      g.fillAndStroke(slice.color, { color: "#FFFFFF", width: slices.length > 1 ? 1 : 0.01 });
      if (props.valueLabels !== false) {
        const text =
          props.valueLabels === "value" ? format(slice.value) : `${Math.round(share * 100)}%`;
        const middle = radius * (hole > 0 ? (1 + hole) / 2 : 0.65);
        // Written only where the slice is wide enough to hold it.
        const room = 2 * Math.PI * middle * share;
        if (room > g.measureText(text, { size: labelSize }) + 2 && share > 0.03) {
          const [tx, ty] = point(turn + share / 2, middle);
          g.text(text, tx, ty, {
            size: labelSize,
            align: "center",
            baseline: "middle",
            color: isDark(slice.color) ? "#FFFFFF" : "#111827",
          });
        }
      }
      turn = end;
    }
  });
}
