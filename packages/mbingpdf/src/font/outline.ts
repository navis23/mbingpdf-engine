/**
 * Glyph outlines as drawing commands, for backends that draw text as shapes (the SVG preview).
 * Coordinates are in font units with y growing upward.
 */
import {
  ARGS_ARE_XY_VALUES,
  decodeGlyph,
  WE_HAVE_A_SCALE,
  WE_HAVE_A_TWO_BY_TWO,
  WE_HAVE_AN_X_AND_Y_SCALE,
} from "./glyf.ts";
import { BinaryReader } from "./reader.ts";

export type OutlineCommand =
  | readonly ["M", number, number]
  | readonly ["L", number, number]
  | readonly ["Q", number, number, number, number]
  | readonly ["C", number, number, number, number, number, number]
  | readonly ["Z"];

/** Reads a 2.14 fixed-point number. */
const f2dot14 = (bytes: Uint8Array, offset: number): number =>
  ((((bytes[offset] as number) << 8) | (bytes[offset + 1] as number)) << 16) / 65536 / 16384;

/**
 * The outline of a TrueType glyph.
 *
 * @param glyphData returns the bytes of a glyph in the `glyf` table
 */
export function trueTypeOutline(
  glyph: number,
  glyphData: (glyph: number) => Uint8Array,
  depth = 0,
): OutlineCommand[] {
  const decoded = decodeGlyph(glyphData(glyph));
  if (!decoded || depth > 8) return [];
  const out: OutlineCommand[] = [];
  if (decoded.kind === "composite") {
    for (const component of decoded.components) {
      // The component's own outline, scaled or sheared, then moved into place.
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      const transform = component.transform;
      if (component.flags & WE_HAVE_A_SCALE) a = d = f2dot14(transform, 0);
      else if (component.flags & WE_HAVE_AN_X_AND_Y_SCALE) {
        a = f2dot14(transform, 0);
        d = f2dot14(transform, 2);
      } else if (component.flags & WE_HAVE_A_TWO_BY_TWO) {
        a = f2dot14(transform, 0);
        b = f2dot14(transform, 2);
        c = f2dot14(transform, 4);
        d = f2dot14(transform, 6);
      }
      const dx = component.flags & ARGS_ARE_XY_VALUES ? component.arg1 : 0;
      const dy = component.flags & ARGS_ARE_XY_VALUES ? component.arg2 : 0;
      for (const command of trueTypeOutline(component.glyph, glyphData, depth + 1)) {
        if (command[0] === "Z") {
          out.push(command);
          continue;
        }
        const moved: (string | number)[] = [command[0]];
        for (let i = 1; i < command.length; i += 2) {
          const x = command[i] as number;
          const y = command[i + 1] as number;
          moved.push(a * x + c * y + dx, b * x + d * y + dy);
        }
        out.push(moved as unknown as OutlineCommand);
      }
    }
    return out;
  }

  let start = 0;
  for (const end of decoded.endPoints) {
    const count = end - start + 1;
    if (count > 0) {
      const at = (i: number): { x: number; y: number; on: boolean } => {
        const index = start + (((i % count) + count) % count);
        return {
          x: decoded.x[index] as number,
          y: decoded.y[index] as number,
          on: decoded.onCurve[index] as boolean,
        };
      };
      // Start on an on-curve point; if there is none, on the midpoint of the first two.
      let first = 0;
      while (first < count && !at(first).on) first++;
      let origin: { x: number; y: number };
      if (first === count) {
        first = 0;
        origin = { x: (at(0).x + at(-1).x) / 2, y: (at(0).y + at(-1).y) / 2 };
        out.push(["M", origin.x, origin.y]);
      } else {
        origin = at(first);
        out.push(["M", origin.x, origin.y]);
        first++;
      }
      const steps = first === 0 ? count : count - 1;
      for (let i = 0; i < steps; i++) {
        const point = at(first + i);
        if (point.on) {
          out.push(["L", point.x, point.y]);
          continue;
        }
        // Two off-curve points in a row imply an on-curve point halfway between them.
        const next = i + 1 < steps ? at(first + i + 1) : { ...origin, on: true };
        if (next.on) {
          out.push(["Q", point.x, point.y, next.x, next.y]);
          if (i + 1 < steps) i++;
        } else {
          out.push(["Q", point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2]);
        }
      }
      // Close with a curve when the last point was a control point leading back to the start.
      const last = at(first + steps - 1);
      if (steps > 0 && !last.on) {
        const previous = out.at(-1);
        if (
          !previous ||
          previous[0] !== "Q" ||
          previous[3] !== origin.x ||
          previous[4] !== origin.y
        ) {
          out.push(["Q", last.x, last.y, origin.x, origin.y]);
        }
      }
      out.push(["Z"]);
    }
    start = end + 1;
  }
  return out;
}

interface CffIndex {
  items: [number, number][];
  end: number;
}

function readIndex(r: BinaryReader, offset: number): CffIndex {
  const count = r.u16At(offset);
  if (count === 0) return { items: [], end: offset + 2 };
  const offSize = r.seek(offset + 2).u8();
  const read = (i: number): number => {
    let value = 0;
    for (let b = 0; b < offSize; b++)
      value = value * 256 + r.seek(offset + 3 + i * offSize + b).u8();
    return value;
  };
  const base = offset + 3 + (count + 1) * offSize - 1;
  const items: [number, number][] = [];
  for (let i = 0; i < count; i++) items.push([base + read(i), base + read(i + 1)]);
  return { items, end: base + read(count) };
}

/** Reads the integer operands of DICT operators, by operator. */
function dictNumbers(data: Uint8Array): Map<number, number[]> {
  const result = new Map<number, number[]>();
  let operands: number[] = [];
  for (let i = 0; i < data.length; ) {
    const b0 = data[i] as number;
    if (b0 <= 21) {
      let op = b0;
      i++;
      if (b0 === 12) op = 0x0c00 | (data[i++] as number);
      result.set(op, operands);
      operands = [];
    } else if (b0 === 28) {
      operands.push(((((data[i + 1] as number) << 8) | (data[i + 2] as number)) << 16) >> 16);
      i += 3;
    } else if (b0 === 29) {
      operands.push(
        ((data[i + 1] as number) << 24) |
          ((data[i + 2] as number) << 16) |
          ((data[i + 3] as number) << 8) |
          (data[i + 4] as number),
      );
      i += 5;
    } else if (b0 === 30) {
      i++;
      while (i < data.length) {
        const byte = data[i++] as number;
        if ((byte & 0x0f) === 0x0f || byte >> 4 === 0x0f) break;
      }
      operands.push(0);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i++;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + (data[i + 1] as number) + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - (data[i + 1] as number) - 108);
      i += 2;
    } else i++;
  }
  return result;
}

const subrBias = (count: number): number => (count < 1240 ? 107 : count < 33900 ? 1131 : 32768);

/** Runs glyph programs (Type 2 charstrings) of a CFF table to get their outlines. */
export class CffOutlines {
  readonly #table: Uint8Array;
  readonly #charStrings: CffIndex;
  readonly #globalSubrs: CffIndex;
  readonly #localSubrs: (CffIndex | undefined)[] = [];
  readonly #fontOf: (glyph: number) => number;

  constructor(table: Uint8Array) {
    this.#table = table;
    const r = new BinaryReader(table);
    const names = readIndex(r, table[2] as number);
    const topDicts = readIndex(r, names.end);
    const strings = readIndex(r, topDicts.end);
    this.#globalSubrs = readIndex(r, strings.end);
    const [topStart, topEnd] = topDicts.items[0] as [number, number];
    const top = dictNumbers(table.subarray(topStart, topEnd));
    this.#charStrings = readIndex(r, top.get(17)?.[0] ?? 0);

    const localSubrsOf = (privateDict: number[] | undefined): CffIndex | undefined => {
      if (!privateDict || privateDict.length < 2) return undefined;
      const [size, offset] = privateDict as [number, number];
      const subrs = dictNumbers(table.subarray(offset, offset + size)).get(19)?.[0];
      return subrs === undefined ? undefined : readIndex(r, offset + subrs);
    };
    const fdArray = top.get(0x0c24)?.[0];
    const fdSelect = top.get(0x0c25)?.[0];
    if (fdArray !== undefined && fdSelect !== undefined) {
      for (const [start, end] of readIndex(r, fdArray).items) {
        this.#localSubrs.push(localSubrsOf(dictNumbers(table.subarray(start, end)).get(18)));
      }
      const format = table[fdSelect] as number;
      if (format === 0) this.#fontOf = (glyph) => table[fdSelect + 1 + glyph] ?? 0;
      else {
        const ranges = r.u16At(fdSelect + 1);
        this.#fontOf = (glyph) => {
          let font = 0;
          for (let i = 0; i < ranges; i++) {
            const at = fdSelect + 3 + i * 3;
            if (r.u16At(at) > glyph) break;
            font = table[at + 2] as number;
          }
          return font;
        };
      }
    } else {
      this.#localSubrs.push(localSubrsOf(top.get(18)));
      this.#fontOf = () => 0;
    }
  }

  outline(glyph: number): OutlineCommand[] {
    const item = this.#charStrings.items[glyph];
    if (!item) return [];
    const table = this.#table;
    const locals = this.#localSubrs[this.#fontOf(glyph)];
    const globals = this.#globalSubrs;
    const out: OutlineCommand[] = [];
    const stack: number[] = [];
    let x = 0;
    let y = 0;
    let stems = 0;
    let open = false;
    let widthSeen = false;
    let finished = false;

    const moveTo = (dx: number, dy: number): void => {
      if (open) out.push(["Z"]);
      x += dx;
      y += dy;
      out.push(["M", x, y]);
      open = true;
    };
    const lineTo = (dx: number, dy: number): void => {
      x += dx;
      y += dy;
      out.push(["L", x, y]);
    };
    const curveTo = (
      dx1: number,
      dy1: number,
      dx2: number,
      dy2: number,
      dx3: number,
      dy3: number,
    ): void => {
      const x1 = x + dx1;
      const y1 = y + dy1;
      const x2 = x1 + dx2;
      const y2 = y1 + dy2;
      x = x2 + dx3;
      y = y2 + dy3;
      out.push(["C", x1, y1, x2, y2, x, y]);
    };
    /** The first operator that clears the stack may be preceded by the glyph's width. */
    const dropWidth = (expected: number): void => {
      if (!widthSeen && stack.length > expected) stack.shift();
      widthSeen = true;
    };

    const run = (start: number, end: number, depth: number): void => {
      for (let i = start; i < end && !finished; ) {
        const b0 = table[i++] as number;
        if (b0 >= 32 || b0 === 28) {
          if (b0 === 28) {
            stack.push(((((table[i] as number) << 8) | (table[i + 1] as number)) << 16) >> 16);
            i += 2;
          } else if (b0 <= 246) stack.push(b0 - 139);
          else if (b0 <= 250) stack.push((b0 - 247) * 256 + (table[i++] as number) + 108);
          else if (b0 <= 254) stack.push(-(b0 - 251) * 256 - (table[i++] as number) - 108);
          else {
            stack.push(
              (((table[i] as number) << 24) |
                ((table[i + 1] as number) << 16) |
                ((table[i + 2] as number) << 8) |
                (table[i + 3] as number)) /
                65536,
            );
            i += 4;
          }
          continue;
        }
        switch (b0) {
          case 1: // hstem
          case 3: // vstem
          case 18: // hstemhm
          case 23: // vstemhm
            dropWidth(stack.length & ~1);
            stems += stack.length >> 1;
            stack.length = 0;
            break;
          case 19: // hintmask
          case 20: // cntrmask
            dropWidth(stack.length & ~1);
            stems += stack.length >> 1;
            stack.length = 0;
            i += (stems + 7) >> 3;
            break;
          case 21: // rmoveto
            dropWidth(2);
            moveTo(stack[0] ?? 0, stack[1] ?? 0);
            stack.length = 0;
            break;
          case 22: // hmoveto
            dropWidth(1);
            moveTo(stack[0] ?? 0, 0);
            stack.length = 0;
            break;
          case 4: // vmoveto
            dropWidth(1);
            moveTo(0, stack[0] ?? 0);
            stack.length = 0;
            break;
          case 5: // rlineto
            for (let k = 0; k + 1 < stack.length; k += 2)
              lineTo(stack[k] as number, stack[k + 1] as number);
            stack.length = 0;
            break;
          case 6: // hlineto
          case 7: {
            // Alternating horizontal and vertical lines.
            let horizontal = b0 === 6;
            for (const value of stack) {
              if (horizontal) lineTo(value, 0);
              else lineTo(0, value);
              horizontal = !horizontal;
            }
            stack.length = 0;
            break;
          }
          case 8: // rrcurveto
            for (let k = 0; k + 5 < stack.length; k += 6) {
              curveTo(
                stack[k] as number,
                stack[k + 1] as number,
                stack[k + 2] as number,
                stack[k + 3] as number,
                stack[k + 4] as number,
                stack[k + 5] as number,
              );
            }
            stack.length = 0;
            break;
          case 24: {
            // rcurveline: curves, then one line.
            let k = 0;
            for (; k + 7 < stack.length; k += 6) {
              curveTo(
                stack[k] as number,
                stack[k + 1] as number,
                stack[k + 2] as number,
                stack[k + 3] as number,
                stack[k + 4] as number,
                stack[k + 5] as number,
              );
            }
            lineTo(stack[k] as number, stack[k + 1] as number);
            stack.length = 0;
            break;
          }
          case 25: {
            // rlinecurve: lines, then one curve.
            let k = 0;
            for (; k + 7 < stack.length; k += 2) lineTo(stack[k] as number, stack[k + 1] as number);
            curveTo(
              stack[k] as number,
              stack[k + 1] as number,
              stack[k + 2] as number,
              stack[k + 3] as number,
              stack[k + 4] as number,
              stack[k + 5] as number,
            );
            stack.length = 0;
            break;
          }
          case 26: {
            // vvcurveto
            let k = 0;
            let dx = 0;
            if (stack.length & 1) dx = stack[k++] as number;
            for (; k + 3 < stack.length; k += 4) {
              curveTo(
                dx,
                stack[k] as number,
                stack[k + 1] as number,
                stack[k + 2] as number,
                0,
                stack[k + 3] as number,
              );
              dx = 0;
            }
            stack.length = 0;
            break;
          }
          case 27: {
            // hhcurveto
            let k = 0;
            let dy = 0;
            if (stack.length & 1) dy = stack[k++] as number;
            for (; k + 3 < stack.length; k += 4) {
              curveTo(
                stack[k] as number,
                dy,
                stack[k + 1] as number,
                stack[k + 2] as number,
                stack[k + 3] as number,
                0,
              );
              dy = 0;
            }
            stack.length = 0;
            break;
          }
          case 30: // vhcurveto
          case 31: {
            // Curves that start alternately vertical and horizontal.
            let horizontal = b0 === 31;
            let k = 0;
            while (k + 3 < stack.length) {
              const last = stack.length - k === 5 ? (stack[k + 4] as number) : 0;
              if (horizontal) {
                curveTo(
                  stack[k] as number,
                  0,
                  stack[k + 1] as number,
                  stack[k + 2] as number,
                  last,
                  stack[k + 3] as number,
                );
              } else {
                curveTo(
                  0,
                  stack[k] as number,
                  stack[k + 1] as number,
                  stack[k + 2] as number,
                  stack[k + 3] as number,
                  last,
                );
              }
              horizontal = !horizontal;
              k += 4;
            }
            stack.length = 0;
            break;
          }
          case 10: // callsubr
          case 29: {
            const index = b0 === 10 ? locals : globals;
            const number = stack.pop();
            if (index && number !== undefined && depth < 10) {
              const subr = index.items[number + subrBias(index.items.length)];
              if (subr) run(subr[0], subr[1], depth + 1);
            }
            break;
          }
          case 11: // return
            return;
          case 14: // endchar
            finished = true;
            break;
          case 12: {
            const b1 = table[i++] as number;
            if (b1 === 35 && stack.length >= 12) {
              // flex: two curves.
              curveTo(
                stack[0] as number,
                stack[1] as number,
                stack[2] as number,
                stack[3] as number,
                stack[4] as number,
                stack[5] as number,
              );
              curveTo(
                stack[6] as number,
                stack[7] as number,
                stack[8] as number,
                stack[9] as number,
                stack[10] as number,
                stack[11] as number,
              );
            } else if (b1 === 34 && stack.length >= 7) {
              // hflex
              curveTo(
                stack[0] as number,
                0,
                stack[1] as number,
                stack[2] as number,
                stack[3] as number,
                0,
              );
              curveTo(
                stack[4] as number,
                0,
                stack[5] as number,
                -(stack[2] as number),
                stack[6] as number,
                0,
              );
            } else if (b1 === 36 && stack.length >= 9) {
              // hflex1
              const dy = (stack[1] as number) + (stack[3] as number) + (stack[7] as number);
              curveTo(
                stack[0] as number,
                stack[1] as number,
                stack[2] as number,
                stack[3] as number,
                stack[4] as number,
                0,
              );
              curveTo(
                stack[5] as number,
                0,
                stack[6] as number,
                stack[7] as number,
                stack[8] as number,
                -dy,
              );
            } else if (b1 === 37 && stack.length >= 11) {
              // flex1: the last argument is along whichever axis moved further.
              const dx =
                (stack[0] as number) +
                (stack[2] as number) +
                (stack[4] as number) +
                (stack[6] as number) +
                (stack[8] as number);
              const dy =
                (stack[1] as number) +
                (stack[3] as number) +
                (stack[5] as number) +
                (stack[7] as number) +
                (stack[9] as number);
              curveTo(
                stack[0] as number,
                stack[1] as number,
                stack[2] as number,
                stack[3] as number,
                stack[4] as number,
                stack[5] as number,
              );
              if (Math.abs(dx) > Math.abs(dy)) {
                curveTo(
                  stack[6] as number,
                  stack[7] as number,
                  stack[8] as number,
                  stack[9] as number,
                  stack[10] as number,
                  -dy,
                );
              } else {
                curveTo(
                  stack[6] as number,
                  stack[7] as number,
                  stack[8] as number,
                  stack[9] as number,
                  -dx,
                  stack[10] as number,
                );
              }
            }
            stack.length = 0;
            break;
          }
          default:
            stack.length = 0;
            break;
        }
      }
    };
    run(item[0], item[1], 0);
    if (open) out.push(["Z"]);
    return out;
  }
}
