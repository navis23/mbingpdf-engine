/**
 * Reading SVG artwork into the display list, as vector shapes.
 *
 * Covers what logos and illustrations exported from drawing tools use: paths, basic shapes,
 * groups, transforms, solid fills and strokes, opacity, and `<use>`. Gradients, patterns,
 * text, images, filters, clipping and masks are not supported; shapes that rely on them are
 * drawn in plain black or skipped.
 */
import { type Color, gray, rgb } from "../core/index.ts";
import type { DisplayItem, PathCommand, StrokeStyle } from "./display.ts";

/** `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

interface Element {
  name: string;
  attributes: Record<string, string>;
  children: Element[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? whole;
  });
}

/** A small XML reader: elements and attributes only, which is all SVG shapes need. */
function parseXml(source: string): Element {
  const root: Element = { name: "#root", attributes: {}, children: [] };
  const stack: Element[] = [root];
  const tag =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    const [, closing, opening, attributeText, selfClosing] = match;
    if (closing !== undefined) {
      if (stack.length > 1) stack.pop();
    } else if (opening !== undefined) {
      const attributes: Record<string, string> = {};
      const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      for (let a = pattern.exec(attributeText ?? ""); a; a = pattern.exec(attributeText ?? "")) {
        attributes[a[1] as string] = decodeEntities(a[2] ?? a[3] ?? "");
      }
      // Drop a namespace prefix: "svg:path" is "path".
      const element: Element = { name: opening.replace(/^.*:/, ""), attributes, children: [] };
      (stack.at(-1) as Element).children.push(element);
      if (selfClosing !== "/") stack.push(element);
    }
  }
  return root;
}

// biome-ignore format: a table
const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", cyan: "#00ffff", aqua: "#00ffff", magenta: "#ff00ff", fuchsia: "#ff00ff",
  gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000", olive: "#808000",
  lime: "#00ff00", teal: "#008080", navy: "#000080", purple: "#800080", orange: "#ffa500",
  pink: "#ffc0cb", brown: "#a52a2a", gold: "#ffd700", indigo: "#4b0082", violet: "#ee82ee",
  crimson: "#dc143c", coral: "#ff7f50", salmon: "#fa8072", khaki: "#f0e68c", tan: "#d2b48c",
  beige: "#f5f5dc", ivory: "#fffff0", lightgray: "#d3d3d3", lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9", darkgrey: "#a9a9a9", dimgray: "#696969", dimgrey: "#696969",
  whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc", slategray: "#708090", darkblue: "#00008b",
  darkgreen: "#006400", darkred: "#8b0000", skyblue: "#87ceeb", steelblue: "#4682b4",
  royalblue: "#4169e1", dodgerblue: "#1e90ff", turquoise: "#40e0d0", tomato: "#ff6347",
};

/** A paint: a colour, nothing, or "the text colour". */
type Paint = Color | "none" | "current";

function parsePaint(value: string): Paint | undefined {
  const text = value.trim().toLowerCase();
  if (text === "none" || text === "transparent") return "none";
  if (text === "currentcolor") return "current";
  const hexText = NAMED_COLORS[text] ?? text;
  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(hexText);
  if (hexMatch) {
    const digits = hexMatch[1] as string;
    const full = digits.length <= 4 ? digits.replace(/./g, "$&$&") : digits;
    const channel = (at: number): number => Number.parseInt(full.slice(at, at + 2), 16) / 255;
    return rgb(channel(0), channel(2), channel(4));
  }
  const functional = /^rgba?\(([^)]*)\)$/.exec(text);
  if (functional) {
    const parts = (functional[1] as string).split(/[\s,/]+/).filter(Boolean);
    const channel = (part: string | undefined): number => {
      const number = Number.parseFloat(part ?? "0");
      return Math.min(1, Math.max(0, part?.endsWith("%") ? number / 100 : number / 255));
    };
    return rgb(channel(parts[0]), channel(parts[1]), channel(parts[2]));
  }
  // Gradients and patterns ("url(#…)") and unknown names: not supported.
  return undefined;
}

const number = (value: string | undefined, fallback = 0): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function parseTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  let result: Matrix = IDENTITY;
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    const args = (match[2] as string)
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args;
    let step: Matrix = IDENTITY;
    switch (match[1]) {
      case "matrix":
        step = [a, b, c, d, e, f];
        break;
      case "translate":
        step = [1, 0, 0, 1, a, b];
        break;
      case "scale":
        step = [a, 0, 0, args.length > 1 ? b : a, 0, 0];
        break;
      case "rotate": {
        const angle = (a * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        // Rotation about (b, c) when given.
        step = [cos, sin, -sin, cos, b - b * cos + c * sin, c - b * sin - c * cos];
        break;
      }
      case "skewX":
        step = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        step = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    result = multiply(result, step);
  }
  return result;
}

/** An elliptical arc as cubic Bézier curves (SVG implementation notes, F.6). */
function arcToCurves(
  x1: number,
  y1: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): PathCommand[] {
  let rx = Math.abs(radiusX);
  let ry = Math.abs(radiusY);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [["L", x2, y2]];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  // Radii too small to span the distance are scaled up.
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (factor * rx * yp) / ry;
  const cyp = (-factor * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angleOf = (ux: number, uy: number): number => Math.atan2(uy, ux);
  const start = angleOf((xp - cxp) / rx, (yp - cyp) / ry);
  let sweepAngle = angleOf((-xp - cxp) / rx, (-yp - cyp) / ry) - start;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
  else if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2) - 1e-9));
  const step = sweepAngle / pieces;
  const handle = (4 / 3) * Math.tan(step / 4);
  const curves: PathCommand[] = [];
  const point = (angle: number): [number, number, number, number] => {
    const ex = rx * Math.cos(angle);
    const ey = ry * Math.sin(angle);
    // The point, and the direction of travel there.
    return [
      cx + cos * ex - sin * ey,
      cy + sin * ex + cos * ey,
      -cos * rx * Math.sin(angle) - sin * ry * Math.cos(angle),
      -sin * rx * Math.sin(angle) + cos * ry * Math.cos(angle),
    ];
  };
  for (let i = 0; i < pieces; i++) {
    const [ax, ay, adx, ady] = point(start + i * step);
    const [bx, by, bdx, bdy] = point(start + (i + 1) * step);
    curves.push([
      "C",
      ax + handle * adx,
      ay + handle * ady,
      bx - handle * bdx,
      by - handle * bdy,
      bx,
      by,
    ]);
  }
  return curves;
}

/** Parses path data into absolute move, line, curve and close commands. */
export function parsePathData(data: string): PathCommand[] {
  const out: PathCommand[] = [];
  const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for the "smooth" commands that mirror it.
  let controlX = 0;
  let controlY = 0;
  let previous = "";
  let command = "";
  const next = (): number => Number(tokens[i++]);
  // Arc flags are single digits that may be written without separators ("a1 1 0 01 2 2").
  const flag = (): boolean => {
    const token = tokens[i] as string;
    if (token.length > 1 && /^[01]/.test(token)) {
      tokens[i] = token.slice(1);
      return token.charAt(0) === "1";
    }
    i++;
    return token === "1";
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i] as string)) command = tokens[i++] as string;
    else if (command === "M") command = "L";
    else if (command === "m") command = "l";
    else if (command === "") break;
    const relative = command === command.toLowerCase();
    const baseX = relative ? x : 0;
    const baseY = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M":
        x = baseX + next();
        y = baseY + next();
        startX = x;
        startY = y;
        out.push(["M", x, y]);
        break;
      case "L":
        x = baseX + next();
        y = baseY + next();
        out.push(["L", x, y]);
        break;
      case "H":
        x = baseX + next();
        out.push(["L", x, y]);
        break;
      case "V":
        y = baseY + next();
        out.push(["L", x, y]);
        break;
      case "C": {
        const x1 = baseX + next();
        const y1 = baseY + next();
        controlX = baseX + next();
        controlY = baseY + next();
        x = baseX + next();
        y = baseY + next();
        out.push(["C", x1, y1, controlX, controlY, x, y]);
        break;
      }
      case "S": {
        const smooth = /[CS]/i.test(previous);
        const x1 = smooth ? 2 * x - controlX : x;
        const y1 = smooth ? 2 * y - controlY : y;
        controlX = baseX + next();
        controlY = baseY + next();
        x = baseX + next();
        y = baseY + next();
        out.push(["C", x1, y1, controlX, controlY, x, y]);
        break;
      }
      case "Q":
      case "T": {
        if (command.toUpperCase() === "Q") {
          controlX = baseX + next();
          controlY = baseY + next();
        } else if (/[QT]/i.test(previous)) {
          controlX = 2 * x - controlX;
          controlY = 2 * y - controlY;
        } else {
          controlX = x;
          controlY = y;
        }
        const endX = baseX + next();
        const endY = baseY + next();
        // A quadratic curve written as the cubic that traces the same line.
        out.push([
          "C",
          x + (2 / 3) * (controlX - x),
          y + (2 / 3) * (controlY - y),
          endX + (2 / 3) * (controlX - endX),
          endY + (2 / 3) * (controlY - endY),
          endX,
          endY,
        ]);
        x = endX;
        y = endY;
        break;
      }
      case "A": {
        const rx = next();
        const ry = next();
        const rotation = next();
        const largeArc = flag();
        const sweep = flag();
        const endX = baseX + next();
        const endY = baseY + next();
        out.push(...arcToCurves(x, y, rx, ry, rotation, largeArc, sweep, endX, endY));
        x = endX;
        y = endY;
        break;
      }
      case "Z":
        out.push(["Z"]);
        x = startX;
        y = startY;
        break;
      default:
        // An unknown letter: stop rather than misread the numbers after it.
        return out;
    }
    if (Number.isNaN(x) || Number.isNaN(y)) return out.slice(0, -1);
    previous = command;
  }
  return out;
}

interface DrawState {
  fill: Paint;
  stroke: Paint;
  strokeWidth: number;
  cap: StrokeStyle["cap"];
  join: StrokeStyle["join"];
  dash: readonly number[] | undefined;
  evenOdd: boolean;
  fillOpacity: number;
  strokeOpacity: number;
}

const KAPPA = 0.5522847498307936;

function ellipsePath(cx: number, cy: number, rx: number, ry: number): PathCommand[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ["Z"],
  ];
}

function shapePath(element: Element): PathCommand[] {
  const a = element.attributes;
  switch (element.name) {
    case "path":
      return parsePathData(a.d ?? "");
    case "rect": {
      const x = number(a.x);
      const y = number(a.y);
      const width = number(a.width);
      const height = number(a.height);
      if (!(width > 0 && height > 0)) return [];
      const rx = Math.min(number(a.rx, number(a.ry)), width / 2);
      const ry = Math.min(number(a.ry, number(a.rx)), height / 2);
      if (rx <= 0 || ry <= 0)
        return [
          ["M", x, y],
          ["L", x + width, y],
          ["L", x + width, y + height],
          ["L", x, y + height],
          ["Z"],
        ];
      const kx = rx * (1 - KAPPA);
      const ky = ry * (1 - KAPPA);
      return [
        ["M", x + rx, y],
        ["L", x + width - rx, y],
        ["C", x + width - kx, y, x + width, y + ky, x + width, y + ry],
        ["L", x + width, y + height - ry],
        ["C", x + width, y + height - ky, x + width - kx, y + height, x + width - rx, y + height],
        ["L", x + rx, y + height],
        ["C", x + kx, y + height, x, y + height - ky, x, y + height - ry],
        ["L", x, y + ry],
        ["C", x, y + ky, x + kx, y, x + rx, y],
        ["Z"],
      ];
    }
    case "circle":
      return number(a.r) > 0
        ? ellipsePath(number(a.cx), number(a.cy), number(a.r), number(a.r))
        : [];
    case "ellipse":
      return number(a.rx) > 0 && number(a.ry) > 0
        ? ellipsePath(number(a.cx), number(a.cy), number(a.rx), number(a.ry))
        : [];
    case "line":
      return [
        ["M", number(a.x1), number(a.y1)],
        ["L", number(a.x2), number(a.y2)],
      ];
    case "polyline":
    case "polygon": {
      const values =
        (a.points ?? "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
      const path: PathCommand[] = [];
      for (let i = 0; i + 1 < values.length; i += 2) {
        path.push([i === 0 ? "M" : "L", values[i] as number, values[i + 1] as number]);
      }
      if (element.name === "polygon" && path.length > 0) path.push(["Z"]);
      return path;
    }
    default:
      return [];
  }
}

function transformPath(path: readonly PathCommand[], matrix: Matrix): PathCommand[] {
  return path.map((command): PathCommand => {
    if (command[0] === "Z") return command;
    const moved: (string | number)[] = [command[0]];
    for (let i = 1; i < command.length; i += 2) {
      const x = command[i] as number;
      const y = command[i + 1] as number;
      moved.push(
        matrix[0] * x + matrix[2] * y + matrix[4],
        matrix[1] * x + matrix[3] * y + matrix[5],
      );
    }
    return moved as unknown as PathCommand;
  });
}

export interface ParsedSvg {
  /** The size of the drawing in its own units. */
  readonly width: number;
  readonly height: number;
  /**
   * The shapes, with the drawing's top-left corner at the origin. The same colour gives the
   * very same array each time, which is how a backend knows artwork it has drawn before.
   */
  items(currentColor: Color): readonly DisplayItem[];
}

const parsed: Map<string, ParsedSvg> = new Map();

/** Reads an SVG document. Throws when it has no `<svg>` element or no usable size. */
export function parseSvg(source: string | Uint8Array): ParsedSvg {
  const text = typeof source === "string" ? source : new TextDecoder().decode(source);
  const cached = parsed.get(text);
  if (cached) return cached;
  const svg = parseXml(text).children.find((child) => child.name === "svg");
  if (!svg) throw new Error("Not an SVG document: no <svg> element found");

  const box = (svg.attributes.viewBox ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const hasViewBox =
    box.length === 4 &&
    box.every(Number.isFinite) &&
    (box[2] as number) > 0 &&
    (box[3] as number) > 0;
  const [minX = 0, minY = 0] = hasViewBox ? box : [];
  const width = hasViewBox ? (box[2] as number) : number(svg.attributes.width);
  const height = hasViewBox ? (box[3] as number) : number(svg.attributes.height);
  if (!(width > 0 && height > 0))
    throw new Error("The SVG has no size: it needs a viewBox, or a width and a height");

  const ids = new Map<string, Element>();
  const index = (element: Element): void => {
    if (element.attributes.id) ids.set(element.attributes.id, element);
    for (const child of element.children) index(child);
  };
  index(svg);

  const byColor = new Map<string, readonly DisplayItem[]>();
  const result: ParsedSvg = {
    width,
    height,
    items(currentColor) {
      const colorKey = JSON.stringify(currentColor);
      let made = byColor.get(colorKey);
      if (!made) {
        made = itemsFor(currentColor);
        byColor.set(colorKey, made);
      }
      return made;
    },
  };
  const itemsFor = (currentColor: Color): DisplayItem[] => {
    const resolve = (paint: Paint): Color | undefined =>
      paint === "none" ? undefined : paint === "current" ? currentColor : paint;

    const draw = (
      element: Element,
      inherited: DrawState,
      matrix: Matrix,
      into: DisplayItem[],
      depth: number,
    ): void => {
      if (depth > 32) return;
      const name = element.name;
      if (
        name === "defs" ||
        name === "symbol" ||
        name === "clipPath" ||
        name === "mask" ||
        name === "metadata" ||
        name === "title" ||
        name === "desc" ||
        name === "style"
      )
        return;
      // The style attribute overrides presentation attributes.
      const a: Record<string, string> = { ...element.attributes };
      for (const declaration of (element.attributes.style ?? "").split(";")) {
        const colon = declaration.indexOf(":");
        if (colon > 0) a[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
      }
      if (a.display === "none" || a.visibility === "hidden") return;

      const state: DrawState = { ...inherited };
      if (a.fill !== undefined) state.fill = parsePaint(a.fill) ?? gray(0);
      if (a.stroke !== undefined) state.stroke = parsePaint(a.stroke) ?? "none";
      if (a["stroke-width"] !== undefined) state.strokeWidth = number(a["stroke-width"], 1);
      if (
        a["stroke-linecap"] === "butt" ||
        a["stroke-linecap"] === "round" ||
        a["stroke-linecap"] === "square"
      )
        state.cap = a["stroke-linecap"];
      if (
        a["stroke-linejoin"] === "miter" ||
        a["stroke-linejoin"] === "round" ||
        a["stroke-linejoin"] === "bevel"
      )
        state.join = a["stroke-linejoin"];
      if (a["stroke-dasharray"] !== undefined) {
        const dash = a["stroke-dasharray"]
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number);
        state.dash =
          dash.length > 0 && dash.every((value) => value >= 0) && dash.some((value) => value > 0)
            ? dash
            : undefined;
      }
      if (a["fill-rule"] !== undefined) state.evenOdd = a["fill-rule"] === "evenodd";
      if (a["fill-opacity"] !== undefined)
        state.fillOpacity = Math.min(1, Math.max(0, number(a["fill-opacity"], 1)));
      if (a["stroke-opacity"] !== undefined)
        state.strokeOpacity = Math.min(1, Math.max(0, number(a["stroke-opacity"], 1)));

      let local = multiply(matrix, parseTransform(a.transform));
      // Opacity applies to the element as a whole, so it gets a group of its own.
      const opacity = a.opacity !== undefined ? Math.min(1, Math.max(0, number(a.opacity, 1))) : 1;
      let target = into;
      if (opacity < 1) {
        const group: DisplayItem[] = [];
        into.push({ type: "group", opacity, items: group });
        target = group;
      }

      if (name === "g" || name === "svg" || name === "a" || name === "switch") {
        for (const child of element.children) draw(child, state, local, target, depth + 1);
        return;
      }
      if (name === "use") {
        const reference = ids.get((a.href ?? a["xlink:href"] ?? "").replace(/^#/, ""));
        if (reference) {
          local = multiply(local, [1, 0, 0, 1, number(a.x), number(a.y)]);
          if (reference.name === "symbol")
            for (const child of reference.children) draw(child, state, local, target, depth + 1);
          else draw(reference, state, local, target, depth + 1);
        }
        return;
      }

      const path = shapePath(element);
      if (path.length === 0) return;
      const commands = transformPath(path, local);
      const fill = resolve(state.fill);
      const strokeColor = state.strokeWidth > 0 ? resolve(state.stroke) : undefined;
      // A stroke is scaled with the drawing; under an uneven scale, by the geometric mean.
      const scale = Math.sqrt(Math.abs(local[0] * local[3] - local[1] * local[2]));
      const stroke: StrokeStyle | undefined = strokeColor
        ? {
            color: strokeColor,
            width: state.strokeWidth * scale,
            ...(state.cap ? { cap: state.cap } : {}),
            ...(state.join ? { join: state.join } : {}),
            ...(state.dash ? { dash: state.dash.map((value) => value * scale) } : {}),
          }
        : undefined;
      const paint = (opacityOf: number, item: DisplayItem): void => {
        if (opacityOf < 1) target.push({ type: "group", opacity: opacityOf, items: [item] });
        else target.push(item);
      };
      if (fill && stroke && state.fillOpacity === 1 && state.strokeOpacity === 1) {
        target.push({
          type: "path",
          commands,
          fill,
          stroke,
          ...(state.evenOdd ? { evenOdd: true } : {}),
        });
        return;
      }
      if (fill && state.fillOpacity > 0) {
        paint(state.fillOpacity, {
          type: "path",
          commands,
          fill,
          ...(state.evenOdd ? { evenOdd: true } : {}),
        });
      }
      if (stroke && state.strokeOpacity > 0)
        paint(state.strokeOpacity, { type: "path", commands, stroke });
    };

    const items: DisplayItem[] = [];
    const initial: DrawState = {
      fill: gray(0),
      stroke: "none",
      strokeWidth: 1,
      cap: undefined,
      join: undefined,
      dash: undefined,
      evenOdd: false,
      fillOpacity: 1,
      strokeOpacity: 1,
    };
    draw(svg, initial, [1, 0, 0, 1, -minX, -minY], items, 0);
    return items;
  };
  if (parsed.size >= 64) parsed.clear();
  parsed.set(text, result);
  return result;
}
