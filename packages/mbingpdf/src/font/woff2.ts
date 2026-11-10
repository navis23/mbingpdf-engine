/**
 * WOFF2 decoding (W3C "WOFF File Format 2.0"): turns a `.woff2` file back into the TrueType or
 * OpenType file it was made from.
 *
 * WOFF2 compresses with Brotli. A Brotli decoder needs a 120 kB dictionary, so instead of
 * bundling one, this module uses the decoder every runtime already has.
 */
import { BinaryReader, BinaryWriter } from "./reader.ts";
import { buildSfnt } from "./sfnt.ts";

/** Decompresses a Brotli stream. */
export type BrotliDecoder = (compressed: Uint8Array) => Uint8Array;

// biome-ignore format: the order is fixed by the specification
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca",
  "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
  "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
  "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

export function isWoff2(data: Uint8Array): boolean {
  return (
    data.length >= 4 && data[0] === 0x77 && data[1] === 0x4f && data[2] === 0x46 && data[3] === 0x32
  );
}

/** Reads a variable-length number of up to five bytes, seven bits each. */
function readBase128(r: BinaryReader): number {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = r.u8();
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error("Malformed WOFF2: number too long");
}

/** Reads the "255UInt16" encoding: one to three bytes for a 16-bit value. */
function read255(r: BinaryReader): number {
  const code = r.u8();
  if (code === 253) return r.u16();
  if (code === 255) return 253 + r.u8();
  if (code === 254) return 506 + r.u8();
  return code;
}

interface TableEntry {
  tag: string;
  transformed: boolean;
  /** Length of the table's data in the decompressed stream. */
  length: number;
  origLength: number;
}

/** Rebuilds the `glyf` and `loca` tables from WOFF2's transformed glyph data. */
function reconstructGlyf(data: Uint8Array): {
  glyf: Uint8Array;
  loca: Uint8Array;
  xMins: Int16Array;
  indexFormat: number;
} {
  const header = new BinaryReader(data);
  header.skip(2);
  const optionFlags = header.u16();
  const numGlyphs = header.u16();
  const indexFormat = header.u16();
  const sizes = [
    header.u32(),
    header.u32(),
    header.u32(),
    header.u32(),
    header.u32(),
    header.u32(),
    header.u32(),
  ];
  let offset = header.offset;
  const stream = (size: number): BinaryReader => {
    const reader = new BinaryReader(data.subarray(offset, offset + size));
    offset += size;
    return reader;
  };
  const contours = stream(sizes[0] as number);
  const points = stream(sizes[1] as number);
  const flags = stream(sizes[2] as number);
  const glyphs = stream(sizes[3] as number);
  const composites = stream(sizes[4] as number);
  const bboxData = stream(sizes[5] as number);
  const instructions = stream(sizes[6] as number);
  const bboxBitmapLength = ((numGlyphs + 31) >> 5) << 2;
  const bboxBitmap = bboxData.bytes.subarray(0, bboxBitmapLength);
  bboxData.seek(bboxBitmapLength);
  const overlapBitmap =
    optionFlags & 1 ? data.subarray(offset, offset + ((numGlyphs + 7) >> 3)) : undefined;

  const glyf = new BinaryWriter();
  const loca = new BinaryWriter();
  const xMins = new Int16Array(numGlyphs);
  const writeOffset = (): void => {
    if (indexFormat === 0) loca.u16(glyf.length / 2);
    else loca.u32(glyf.length);
  };

  for (let glyph = 0; glyph < numGlyphs; glyph++) {
    writeOffset();
    const contourCount = contours.i16();
    const hasBbox = ((bboxBitmap[glyph >> 3] as number) & (0x80 >> (glyph & 7))) !== 0;
    if (contourCount === 0) continue;

    if (contourCount < 0) {
      // Composite: the component records are stored as they are.
      if (!hasBbox) throw new Error("Malformed WOFF2: composite glyph without a bounding box");
      const start = composites.offset;
      let componentFlags: number;
      let hasInstructions = false;
      do {
        componentFlags = composites.u16();
        composites.skip(2);
        composites.skip(componentFlags & 0x0001 ? 4 : 2);
        if (componentFlags & 0x0008) composites.skip(2);
        else if (componentFlags & 0x0040) composites.skip(4);
        else if (componentFlags & 0x0080) composites.skip(8);
        if (componentFlags & 0x0100) hasInstructions = true;
      } while (componentFlags & 0x0020);
      glyf.i16(-1);
      const xMin = bboxData.i16();
      xMins[glyph] = xMin;
      glyf.i16(xMin).i16(bboxData.i16()).i16(bboxData.i16()).i16(bboxData.i16());
      glyf.bytes(composites.bytes.subarray(start, composites.offset));
      if (hasInstructions) {
        const length = read255(glyphs);
        glyf
          .u16(length)
          .bytes(instructions.bytes.subarray(instructions.offset, instructions.offset + length));
        instructions.skip(length);
      }
      glyf.align(4);
      continue;
    }

    const endPoints: number[] = [];
    let pointCount = 0;
    for (let i = 0; i < contourCount; i++) {
      pointCount += read255(points);
      endPoints.push(pointCount - 1);
    }
    const xs = new Int32Array(pointCount);
    const ys = new Int32Array(pointCount);
    const onCurve = new Uint8Array(pointCount);
    let x = 0;
    let y = 0;
    for (let i = 0; i < pointCount; i++) {
      const flag = flags.u8();
      onCurve[i] = flag & 0x80 ? 0 : 1;
      const code = flag & 0x7f;
      // Each point is a "triplet": a flag byte selects how many coordinate bytes follow.
      let dx: number;
      let dy: number;
      const sign = (bit: number, value: number): number => (bit & 1 ? value : -value);
      if (code < 10) {
        dx = 0;
        dy = sign(code, ((code & 14) << 7) + glyphs.u8());
      } else if (code < 20) {
        dx = sign(code, (((code - 10) & 14) << 7) + glyphs.u8());
        dy = 0;
      } else if (code < 84) {
        const b0 = code - 20;
        const b1 = glyphs.u8();
        dx = sign(code, 1 + (b0 & 0x30) + (b1 >> 4));
        dy = sign(code >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
      } else if (code < 120) {
        const b0 = code - 84;
        dx = sign(code, 1 + (Math.floor(b0 / 12) << 8) + glyphs.u8());
        dy = sign(code >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphs.u8());
      } else if (code < 124) {
        const b1 = glyphs.u8();
        const b2 = glyphs.u8();
        dx = sign(code, (b1 << 4) + (b2 >> 4));
        dy = sign(code >> 1, ((b2 & 0x0f) << 8) + glyphs.u8());
      } else {
        dx = sign(code, glyphs.u16());
        dy = sign(code >> 1, glyphs.u16());
      }
      x += dx;
      y += dy;
      xs[i] = x;
      ys[i] = y;
    }
    const instructionLength = read255(glyphs);

    let xMin: number;
    let yMin: number;
    let xMax: number;
    let yMax: number;
    if (hasBbox) {
      xMin = bboxData.i16();
      yMin = bboxData.i16();
      xMax = bboxData.i16();
      yMax = bboxData.i16();
    } else {
      xMin = yMin = 32767;
      xMax = yMax = -32768;
      for (let i = 0; i < pointCount; i++) {
        xMin = Math.min(xMin, xs[i] as number);
        xMax = Math.max(xMax, xs[i] as number);
        yMin = Math.min(yMin, ys[i] as number);
        yMax = Math.max(yMax, ys[i] as number);
      }
    }
    xMins[glyph] = xMin;
    glyf.i16(contourCount).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
    for (const end of endPoints) glyf.u16(end);
    glyf.u16(instructionLength);
    glyf.bytes(
      instructions.bytes.subarray(instructions.offset, instructions.offset + instructionLength),
    );
    instructions.skip(instructionLength);

    // Flags, then x deltas, then y deltas, in the glyf table's own compact form.
    const overlap = overlapBitmap
      ? ((overlapBitmap[glyph >> 3] as number) & (0x80 >> (glyph & 7))) !== 0
      : false;
    const glyphFlags: number[] = [];
    const xBytes = new BinaryWriter();
    const yBytes = new BinaryWriter();
    let previousX = 0;
    let previousY = 0;
    for (let i = 0; i < pointCount; i++) {
      let flag = onCurve[i] as number;
      if (i === 0 && overlap) flag |= 0x40;
      const dx = (xs[i] as number) - previousX;
      const dy = (ys[i] as number) - previousY;
      previousX = xs[i] as number;
      previousY = ys[i] as number;
      if (dx === 0) flag |= 0x10;
      else if (dx > -256 && dx < 256) {
        flag |= 0x02 | (dx > 0 ? 0x10 : 0);
        xBytes.u8(Math.abs(dx));
      } else xBytes.i16(dx);
      if (dy === 0) flag |= 0x20;
      else if (dy > -256 && dy < 256) {
        flag |= 0x04 | (dy > 0 ? 0x20 : 0);
        yBytes.u8(Math.abs(dy));
      } else yBytes.i16(dy);
      glyphFlags.push(flag);
    }
    for (let i = 0; i < pointCount; ) {
      const flag = glyphFlags[i] as number;
      let run = 1;
      while (i + run < pointCount && glyphFlags[i + run] === flag && run < 256) run++;
      if (run > 1) glyf.u8(flag | 0x08).u8(run - 1);
      else glyf.u8(flag);
      i += run;
    }
    glyf.bytes(xBytes.toBytes()).bytes(yBytes.toBytes()).align(4);
  }
  writeOffset();
  return { glyf: glyf.toBytes(), loca: loca.toBytes(), xMins, indexFormat };
}

/** Rebuilds `hmtx` when WOFF2 left out side bearings that equal each glyph's left edge. */
function reconstructHmtx(
  data: Uint8Array,
  numGlyphs: number,
  numberOfHMetrics: number,
  xMins: Int16Array,
): Uint8Array {
  const r = new BinaryReader(data);
  const flags = r.u8();
  const advances: number[] = [];
  for (let i = 0; i < numberOfHMetrics; i++) advances.push(r.u16());
  const out = new BinaryWriter();
  for (let i = 0; i < numberOfHMetrics; i++) {
    out.u16(advances[i] as number).i16(flags & 1 ? (xMins[i] as number) : r.i16());
  }
  for (let i = numberOfHMetrics; i < numGlyphs; i++) {
    out.i16(flags & 2 ? (xMins[i] as number) : r.i16());
  }
  return out.toBytes();
}

/**
 * Decodes a WOFF2 file into the bytes of the original font.
 *
 * @param brotli decompresses the font data; see {@link loadFont} for a version that finds
 *   the runtime's decoder by itself
 */
export function decodeWoff2(input: Uint8Array, brotli: BrotliDecoder): Uint8Array {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (!isWoff2(data)) throw new Error("Not a WOFF2 file");
  if (data.length < 48) throw new Error("Malformed WOFF2: the file is too short");
  const r = new BinaryReader(data, 4);
  const flavor = r.u32();
  r.skip(4);
  const numTables = r.u16();
  r.skip(6);
  const compressedSize = r.u32();
  r.seek(48);
  if (flavor === 0x74746366) throw new Error("WOFF2 font collections are not supported");

  const entries: TableEntry[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = r.u8();
    const tag = (flags & 0x3f) === 0x3f ? r.tag() : (KNOWN_TAGS[flags & 0x3f] as string);
    const version = flags >> 6;
    const origLength = readBase128(r);
    // glyf and loca are transformed at version 0 and plain at 3; every other table is the
    // other way round.
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    entries.push({
      tag,
      transformed,
      origLength,
      length: transformed ? readBase128(r) : origLength,
    });
  }

  const stream = brotli(data.subarray(r.offset, r.offset + compressedSize));
  const raw = new Map<string, Uint8Array>();
  let offset = 0;
  for (const entry of entries) {
    if (offset + entry.length > stream.length)
      throw new Error("Malformed WOFF2: table data is cut short");
    raw.set(entry.tag, stream.subarray(offset, offset + entry.length));
    offset += entry.length;
  }

  const tables = new Map<string, Uint8Array>();
  let xMins: Int16Array | undefined;
  const transformedTags = new Set(
    entries.filter((entry) => entry.transformed).map((entry) => entry.tag),
  );
  for (const entry of entries) {
    if (!entry.transformed) tables.set(entry.tag, raw.get(entry.tag) as Uint8Array);
  }
  if (transformedTags.has("glyf")) {
    const rebuilt = reconstructGlyf(raw.get("glyf") as Uint8Array);
    tables.set("glyf", rebuilt.glyf);
    tables.set("loca", rebuilt.loca);
    xMins = rebuilt.xMins;
  }
  if (transformedTags.has("hmtx")) {
    const hhea = tables.get("hhea");
    const maxp = tables.get("maxp");
    if (!hhea || !maxp || !xMins) throw new Error("Malformed WOFF2: hmtx cannot be rebuilt");
    tables.set(
      "hmtx",
      reconstructHmtx(
        raw.get("hmtx") as Uint8Array,
        new BinaryReader(maxp).u16At(4),
        new BinaryReader(hhea).u16At(34),
        xMins,
      ),
    );
  }
  for (const tag of transformedTags) {
    if (tag !== "glyf" && tag !== "loca" && tag !== "hmtx") {
      throw new Error(`Malformed WOFF2: unknown transform on table ${tag}`);
    }
  }
  const head = tables.get("head");
  if (head) {
    // The whole-file checksum is recomputed for the rebuilt file.
    const copy = head.slice();
    new DataView(copy.buffer).setUint32(8, 0);
    tables.set("head", copy);
  }
  return buildSfnt(tables, flavor);
}

interface BuiltinZlib {
  brotliDecompressSync(data: Uint8Array): Uint8Array;
}

/** The Brotli decoder built into Node, Bun and Deno, if this is one of them. */
export function builtinBrotli(): BrotliDecoder | undefined {
  const runtime = globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } };
  const zlib = runtime.process?.getBuiltinModule?.("node:zlib") as BuiltinZlib | undefined;
  if (!zlib?.brotliDecompressSync) return undefined;
  return (compressed) => {
    const result = zlib.brotliDecompressSync(compressed);
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  };
}

/** Decompresses Brotli with the browser's streaming decoder. */
async function streamBrotli(compressed: Uint8Array): Promise<Uint8Array> {
  let stream: DecompressionStream;
  try {
    stream = new DecompressionStream("brotli" as CompressionFormat);
  } catch {
    throw new Error(
      "This runtime has no Brotli decoder, so WOFF2 fonts cannot be read here. Use the TTF or " +
        "OTF version of the font, or pass a decoder to decodeWoff2().",
    );
  }
  const writer = stream.writable.getWriter();
  // Errors surface through the reader; the writer's promises must not go unhandled.
  writer.write(Uint8Array.from(compressed)).catch(() => {});
  writer.close().catch(() => {});
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Returns the bytes of a TrueType or OpenType font for any supported font file: WOFF2 is
 * decoded with the runtime's own Brotli decoder, anything else is returned unchanged.
 */
export async function unwrapFont(data: Uint8Array): Promise<Uint8Array> {
  if (!isWoff2(data)) return data;
  const builtin = builtinBrotli();
  if (builtin) return decodeWoff2(data, builtin);
  // decodeWoff2 is synchronous, so decompress first and hand the result over.
  const r = new BinaryReader(data);
  const numTables = r.u16At(12);
  r.seek(48);
  for (let i = 0; i < numTables; i++) {
    const flags = r.u8();
    if ((flags & 0x3f) === 0x3f) r.skip(4);
    const tag = (flags & 0x3f) === 0x3f ? "" : (KNOWN_TAGS[flags & 0x3f] as string);
    readBase128(r);
    const version = flags >> 6;
    if (tag === "glyf" || tag === "loca" ? version === 0 : version !== 0) readBase128(r);
  }
  const decompressed = await streamBrotli(data.subarray(r.offset, r.offset + r.u32At(20)));
  return decodeWoff2(data, () => decompressed);
}
