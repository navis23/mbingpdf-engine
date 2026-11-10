import { BinaryReader, BinaryWriter } from "./reader.ts";

/** The table directory of an sfnt container (TrueType or OpenType file). */
export interface Sfnt {
  /** `0x00010000` or `true` for TrueType outlines, `OTTO` for CFF. */
  readonly flavor: "truetype" | "cff";
  readonly tables: ReadonlyMap<string, Uint8Array>;
}

export function parseSfnt(input: Uint8Array): Sfnt {
  // Node's Buffer is a Uint8Array whose slice() returns a view instead of a copy. Re-wrap the
  // input so the tables are plain Uint8Arrays and behave the same on every runtime.
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < 12) throw new Error("Not a font: the file is too short");
  const reader = new BinaryReader(data);
  const version = reader.tag();
  let flavor: Sfnt["flavor"];
  if (version === "\x00\x01\x00\x00" || version === "true") flavor = "truetype";
  else if (version === "OTTO") flavor = "cff";
  else if (version === "ttcf") throw new Error("Font collections (.ttc) are not supported yet");
  else if (version === "wOFF")
    throw new Error("WOFF 1 fonts are not supported; use TTF, OTF or WOFF2");
  else if (version === "wOF2") throw new Error("WOFF2 fonts are not supported yet");
  else throw new Error("Not a font: unrecognised file signature");

  const count = reader.u16();
  reader.skip(6);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const tag = reader.tag();
    reader.skip(4); // checksum
    const offset = reader.u32();
    const length = reader.u32();
    if (offset + length > data.length)
      throw new Error(`Font table ${tag} runs past the end of the file`);
    tables.set(tag, data.subarray(offset, offset + length));
  }
  return { flavor, tables };
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  const whole = data.length & ~3;
  for (let i = 0; i < whole; i += 4) {
    sum =
      (sum +
        (((data[i] as number) << 24) |
          ((data[i + 1] as number) << 16) |
          ((data[i + 2] as number) << 8) |
          (data[i + 3] as number))) >>>
      0;
  }
  let last = 0;
  for (let i = whole; i < data.length; i++) last |= (data[i] as number) << (24 - 8 * (i - whole));
  return (sum + last) >>> 0;
}

/** Assembles tables into a TrueType file with correct checksums. */
export function buildSfnt(tables: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const count = tags.length;
  const entrySelector = Math.floor(Math.log2(count));
  const searchRange = 2 ** entrySelector * 16;
  const out = new BinaryWriter();
  out
    .u32(0x00010000)
    .u16(count)
    .u16(searchRange)
    .u16(entrySelector)
    .u16(count * 16 - searchRange);

  let offset = 12 + count * 16;
  let headOffset = -1;
  for (const tag of tags) {
    const table = tables.get(tag) as Uint8Array;
    if (tag === "head") headOffset = offset;
    out.tag(tag).u32(checksum(table)).u32(offset).u32(table.length);
    offset += (table.length + 3) & ~3;
  }
  for (const tag of tags) out.bytes(tables.get(tag) as Uint8Array).align(4);

  const file = out.toBytes();
  if (headOffset >= 0) {
    // head.checkSumAdjustment makes the checksum of the whole file equal 0xB1B0AFBA. The head
    // table passed in must have that field set to zero.
    const adjustment = (0xb1b0afba - checksum(file)) >>> 0;
    new DataView(file.buffer).setUint32(headOffset + 8, adjustment);
  }
  return file;
}
