/**
 * Compact Font Format (Adobe Technical Note #5176): the outlines of most `.otf` fonts.
 *
 * Only what subsetting needs is read: the table's structure, not the glyph programs. A subset
 * keeps the charstrings of the wanted glyphs and all subroutines, and is always written as a
 * CID-keyed font whose CIDs equal the new glyph numbers, which is the form a PDF wants.
 */
import { BinaryReader, BinaryWriter } from "./reader.ts";

// Top DICT operators. Two-byte operators (12 x) are written as 0x0c00 | x.
const OP_CHARSET = 15;
const OP_ENCODING = 16;
const OP_CHARSTRINGS = 17;
const OP_PRIVATE = 18;
const OP_SUBRS = 19;
const OP_UNIQUE_ID = 13;
const OP_XUID = 14;
const OP_ROS = 0x0c1e;
const OP_CID_COUNT = 0x0c22;
const OP_FD_ARRAY = 0x0c24;
const OP_FD_SELECT = 0x0c25;
/** Number of predefined strings; custom string IDs start here. */
const STANDARD_STRINGS = 391;

interface DictEntry {
  op: number;
  operands: number[];
  /** The bytes of the operands and operator, for copying an entry unchanged. */
  raw: Uint8Array;
}

function parseDict(data: Uint8Array): DictEntry[] {
  const entries: DictEntry[] = [];
  let operands: number[] = [];
  let start = 0;
  for (let i = 0; i < data.length; ) {
    const b0 = data[i] as number;
    if (b0 <= 21) {
      let op = b0;
      i++;
      if (b0 === 12) op = 0x0c00 | (data[i++] as number);
      entries.push({ op, operands, raw: data.subarray(start, i) });
      operands = [];
      start = i;
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
      // A real number in packed decimal; its value is never needed here, only its length.
      i++;
      while (i < data.length) {
        const byte = data[i++] as number;
        if ((byte & 0x0f) === 0x0f || byte >> 4 === 0x0f) break;
      }
      operands.push(Number.NaN);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i++;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + (data[i + 1] as number) + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - (data[i + 1] as number) - 108);
      i += 2;
    } else {
      throw new Error("Malformed CFF: unexpected byte in a DICT");
    }
  }
  return entries;
}

interface Index {
  /** Start and end offset of each item in the table. */
  items: [number, number][];
  /** Offset of the first byte after the INDEX. */
  end: number;
}

function readIndex(r: BinaryReader, offset: number): Index {
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

function writeIndex(out: BinaryWriter, items: readonly Uint8Array[]): void {
  out.u16(items.length);
  if (items.length === 0) return;
  let total = 1;
  for (const item of items) total += item.length;
  const offSize = total < 0x100 ? 1 : total < 0x10000 ? 2 : total < 0x1000000 ? 3 : 4;
  out.u8(offSize);
  let offset = 1;
  const writeOffset = (value: number): void => {
    for (let b = offSize - 1; b >= 0; b--) out.u8(Math.floor(value / 256 ** b) & 0xff);
  };
  writeOffset(offset);
  for (const item of items) {
    offset += item.length;
    writeOffset(offset);
  }
  for (const item of items) out.bytes(item);
}

function indexBytes(items: readonly Uint8Array[]): Uint8Array {
  const out = new BinaryWriter();
  writeIndex(out, items);
  return out.toBytes();
}

/** A number as a five-byte integer operand, so that its size never depends on its value. */
function int5(out: BinaryWriter, value: number): void {
  out.u8(29).u32(value >>> 0);
}

function operator(out: BinaryWriter, op: number): void {
  if (op >= 0x0c00) out.u8(12).u8(op & 0xff);
  else out.u8(op);
}

/**
 * Builds a CFF table holding only the given glyphs, in the order given (glyph 0 first; a
 * glyph may be repeated). The result is CID-keyed, with CID n drawing the n-th glyph.
 */
export function subsetCff(table: Uint8Array, glyphs: readonly number[]): Uint8Array {
  const r = new BinaryReader(table);
  if (table[0] !== 1)
    throw new Error("Unsupported CFF version (CFF2 variable fonts are not supported)");
  const names = readIndex(r, table[2] as number);
  const topDicts = readIndex(r, names.end);
  const strings = readIndex(r, topDicts.end);
  const globalSubrs = readIndex(r, strings.end);
  const topItem = topDicts.items[0];
  if (!topItem) throw new Error("Malformed CFF: no Top DICT");
  const top = parseDict(table.subarray(topItem[0], topItem[1]));
  const find = (entries: DictEntry[], op: number): number[] | undefined =>
    entries.find((entry) => entry.op === op)?.operands;

  const charStringsAt = find(top, OP_CHARSTRINGS)?.[0];
  if (charStringsAt === undefined) throw new Error("Malformed CFF: no CharStrings");
  const charStrings = readIndex(r, charStringsAt);
  const isCid = find(top, OP_ROS) !== undefined;

  // Font DICTs: a CID-keyed font has several, each with its own Private DICT and subroutines;
  // a name-keyed font has one Private DICT in the Top DICT.
  let fontDicts: DictEntry[][];
  let fontOf: (glyph: number) => number;
  if (isCid) {
    const fdArrayAt = find(top, OP_FD_ARRAY)?.[0];
    const fdSelectAt = find(top, OP_FD_SELECT)?.[0];
    if (fdArrayAt === undefined || fdSelectAt === undefined) {
      throw new Error("Malformed CFF: CID-keyed font without FDArray or FDSelect");
    }
    fontDicts = readIndex(r, fdArrayAt).items.map(([start, end]) =>
      parseDict(table.subarray(start, end)),
    );
    const format = r.seek(fdSelectAt).u8();
    if (format === 0) fontOf = (glyph) => table[fdSelectAt + 1 + glyph] ?? 0;
    else if (format === 3) {
      const ranges = r.u16At(fdSelectAt + 1);
      fontOf = (glyph) => {
        let font = 0;
        for (let i = 0; i < ranges; i++) {
          const at = fdSelectAt + 3 + i * 3;
          if (r.u16At(at) > glyph) break;
          font = table[at + 2] as number;
        }
        return font;
      };
    } else throw new Error("Malformed CFF: unknown FDSelect format");
  } else {
    fontDicts = [top.filter((entry) => entry.op === OP_PRIVATE)];
    fontOf = () => 0;
  }

  // Keep only the Font DICTs the wanted glyphs use.
  const usedFonts = [...new Set(glyphs.map(fontOf))].sort((a, b) => a - b);
  const newFontIndex = new Map(usedFonts.map((font, i) => [font, i]));
  const privates = usedFonts.map((font) => {
    const dict = fontDicts[font];
    const location = dict ? find(dict, OP_PRIVATE) : undefined;
    if (!dict || !location) throw new Error("Malformed CFF: Font DICT without a Private DICT");
    const [size, at] = location as [number, number];
    const entries = parseDict(table.subarray(at, at + size));
    const body = new BinaryWriter();
    for (const entry of entries) {
      if (entry.op !== OP_SUBRS) body.bytes(entry.raw);
    }
    // Local subroutines follow their Private DICT; the operand is the distance from its start.
    const subrsOffset = find(entries, OP_SUBRS)?.[0];
    let subrs: Uint8Array = new Uint8Array(0);
    if (subrsOffset !== undefined) {
      const index = readIndex(r, at + subrsOffset);
      subrs = table.subarray(at + subrsOffset, index.end);
      int5(body, body.length + 6);
      operator(body, OP_SUBRS);
    }
    // The rest of the Font DICT (font name, matrix) is kept as it is.
    const rest = new BinaryWriter();
    if (isCid) {
      for (const entry of dict) {
        if (entry.op !== OP_PRIVATE) rest.bytes(entry.raw);
      }
    }
    return { dict: body.toBytes(), subrs, rest: rest.toBytes() };
  });

  // Strings: the originals, plus the registry and ordering names a CID-keyed font declares.
  const stringItems = strings.items.map(([start, end]) => table.subarray(start, end));
  const encoder = new TextEncoder();
  const topOut = new BinaryWriter();
  if (!isCid) {
    int5(topOut, STANDARD_STRINGS + stringItems.length);
    int5(topOut, STANDARD_STRINGS + stringItems.length + 1);
    int5(topOut, 0);
    operator(topOut, OP_ROS);
    stringItems.push(encoder.encode("Adobe"), encoder.encode("Identity"));
  }
  const replaced = new Set([
    OP_CHARSET,
    OP_ENCODING,
    OP_CHARSTRINGS,
    OP_PRIVATE,
    OP_UNIQUE_ID,
    OP_XUID,
    OP_CID_COUNT,
    OP_FD_ARRAY,
    OP_FD_SELECT,
  ]);
  for (const entry of top) {
    if (!replaced.has(entry.op)) topOut.bytes(entry.raw);
  }
  int5(topOut, glyphs.length);
  operator(topOut, OP_CID_COUNT);
  const offsetsAt = topOut.length;
  // Placeholders for the four offsets, patched once the layout is known.
  for (const op of [OP_CHARSET, OP_CHARSTRINGS, OP_FD_ARRAY, OP_FD_SELECT]) {
    int5(topOut, 0);
    operator(topOut, op);
  }
  const topDict = topOut.toBytes();

  // charset: CIDs 1…n-1 for glyphs 1…n-1 (glyph 0 is always .notdef).
  const charset = new BinaryWriter();
  if (glyphs.length > 1)
    charset
      .u8(2)
      .u16(1)
      .u16(glyphs.length - 2);
  else charset.u8(0);
  const fdSelect = new BinaryWriter();
  if (usedFonts.length === 1) {
    fdSelect.u8(3).u16(1).u16(0).u8(0).u16(glyphs.length);
  } else {
    fdSelect.u8(0);
    for (const glyph of glyphs) fdSelect.u8(newFontIndex.get(fontOf(glyph)) as number);
  }
  const charStringItems = glyphs.map((glyph) => {
    const item = charStrings.items[glyph] ?? charStrings.items[0];
    if (!item) throw new Error("Malformed CFF: empty CharStrings");
    return table.subarray(item[0], item[1]);
  });

  // Lay the table out. Every DICT that holds an offset uses fixed-size numbers, so sizes are
  // known before the offsets are.
  const nameBytes = table.subarray(table[2] as number, names.end);
  const topIndex = indexBytes([topDict]);
  const stringBytes = indexBytes(stringItems);
  const globalSubrBytes = table.subarray(strings.end, globalSubrs.end);
  const charStringBytes = indexBytes(charStringItems);
  const fontDictSize = (i: number): number =>
    (privates[i] as { rest: Uint8Array }).rest.length + 11;
  const fdArrayPlaceholder = indexBytes(
    privates.map((_private, i) => new Uint8Array(fontDictSize(i))),
  );

  let offset = 4 + nameBytes.length + topIndex.length + stringBytes.length + globalSubrBytes.length;
  const charsetAt = offset;
  offset += charset.length;
  const fdSelectAt = offset;
  offset += fdSelect.length;
  const charStringsOut = offset;
  offset += charStringBytes.length;
  const fdArrayOut = offset;
  offset += fdArrayPlaceholder.length;
  const fontDictItems = privates.map((entry) => {
    const dict = new BinaryWriter();
    dict.bytes(entry.rest);
    int5(dict, entry.dict.length);
    int5(dict, offset);
    operator(dict, OP_PRIVATE);
    offset += entry.dict.length + entry.subrs.length;
    return dict.toBytes();
  });

  const patched = topDict.slice();
  const view = new DataView(patched.buffer);
  [charsetAt, charStringsOut, fdArrayOut, fdSelectAt].forEach((value, i) => {
    // Each placeholder is a 5-byte number and a 1- or 2-byte operator.
    const at = offsetsAt + (i < 2 ? i * 6 : 12 + (i - 2) * 7);
    view.setUint32(at + 1, value);
  });

  const out = new BinaryWriter();
  out.u8(1).u8(0).u8(4).u8(4);
  out.bytes(nameBytes);
  writeIndex(out, [patched]);
  out.bytes(stringBytes).bytes(globalSubrBytes);
  out.bytes(charset.toBytes()).bytes(fdSelect.toBytes()).bytes(charStringBytes);
  writeIndex(out, fontDictItems);
  for (const entry of privates) out.bytes(entry.dict).bytes(entry.subrs);
  return out.toBytes();
}
