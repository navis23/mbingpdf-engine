/**
 * The sRGB colour profile, built from its published numbers instead of carried as a file.
 * Archival standards want every colour tied to a profile; this is the one for ordinary
 * screen colours. It is an ICC version 2 display profile of about 1 kB.
 */

/** The sRGB primaries and white, adapted to the D50 white that profiles are measured against. */
const RED = [0.43607, 0.22249, 0.01392] as const;
const GREEN = [0.38515, 0.71687, 0.09708] as const;
const BLUE = [0.14307, 0.06061, 0.7141] as const;
const WHITE = [0.9642, 1, 0.82491] as const;

const DESCRIPTION = "sRGB IEC61966-2.1";
const COPYRIGHT = "No copyright, use freely";
/** How many steps the tone curve is stored in. */
const CURVE_STEPS = 256;

let cached: Uint8Array | undefined;

/** The bytes of an sRGB ICC profile. The same array is returned every time: do not change it. */
export function srgbProfile(): Uint8Array {
  if (cached) return cached;

  const tag = (signature: string, body: number[]): number[] => [
    ...ascii(signature),
    0,
    0,
    0,
    0,
    ...body,
  ];
  const xyz = (value: readonly number[]): number[] => tag("XYZ ", value.flatMap(fixed));
  const description = tag("desc", [
    ...uint32(DESCRIPTION.length + 1),
    ...ascii(DESCRIPTION),
    0,
    // No Unicode and no script-code version of the name: 4 + 4 + 2 + 1 + 67 empty bytes.
    ...new Array<number>(78).fill(0),
  ]);
  const curve: number[] = [...uint32(CURVE_STEPS)];
  for (let i = 0; i < CURVE_STEPS; i++) {
    const encoded = i / (CURVE_STEPS - 1);
    const linear = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
    const value = Math.round(linear * 65535);
    curve.push(value >> 8, value & 0xff);
  }

  // The three channels share one tone curve, stored once.
  const blocks: number[][] = [
    description,
    tag("text", [...ascii(COPYRIGHT), 0]),
    xyz(WHITE),
    xyz(RED),
    xyz(GREEN),
    xyz(BLUE),
    tag("curv", curve),
  ];
  const entries: [string, number][] = [
    ["desc", 0],
    ["cprt", 1],
    ["wtpt", 2],
    ["rXYZ", 3],
    ["gXYZ", 4],
    ["bXYZ", 5],
    ["rTRC", 6],
    ["gTRC", 6],
    ["bTRC", 6],
  ];

  const headerSize = 128;
  const tableSize = 4 + entries.length * 12;
  const offsets: number[] = [];
  let size = headerSize + tableSize;
  for (const block of blocks) {
    offsets.push(size);
    size += Math.ceil(block.length / 4) * 4;
  }

  const out = new Uint8Array(size);
  const put = (at: number, bytes: number[]): void => out.set(bytes, at);
  put(0, uint32(size));
  put(8, [2, 0x10, 0, 0]); // version 2.1
  put(12, ascii("mntrRGB XYZ "));
  put(24, [0x07, 0xea, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]); // 1 January 2026, a fixed date
  put(36, ascii("acsp"));
  put(68, WHITE.flatMap(fixed)); // the illuminant
  put(headerSize, uint32(entries.length));
  entries.forEach(([signature, block], i) => {
    put(headerSize + 4 + i * 12, [
      ...ascii(signature),
      ...uint32(offsets[block] as number),
      ...uint32((blocks[block] as number[]).length),
    ]);
  });
  blocks.forEach((block, i) => {
    put(offsets[i] as number, block);
  });
  cached = out;
  return out;
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** A number as 16 bits of whole part and 16 bits of fraction. */
function fixed(value: number): number[] {
  return uint32(Math.round(value * 65536));
}
