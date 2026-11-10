/**
 * The cryptography that PDF encryption needs: SHA-256, SHA-384, SHA-512 and AES encryption.
 * Written out here because a PDF must be producible without waiting (`render.sync`) on every
 * runtime, which rules out the asynchronous Web Crypto API. Used for nothing but encrypting
 * files with a password; checked against the runtime's own implementations in the tests.
 */

// ----- SHA-2 (FIPS 180-4) -----

const PRIMES: number[] = [];
for (let candidate = 2; PRIMES.length < 80; candidate++) {
  if (PRIMES.every((prime) => candidate % prime !== 0)) PRIMES.push(candidate);
}

/** The largest integer whose `power`-th power is at most `value`. */
function integerRoot(value: bigint, power: 2 | 3): bigint {
  let low = 0n;
  let high = 1n << 128n;
  while (low < high) {
    const middle = (low + high + 1n) >> 1n;
    if ((power === 2 ? middle * middle : middle * middle * middle) <= value) low = middle;
    else high = middle - 1n;
  }
  return low;
}

/** The first 64 bits of the fractional part of a prime's square or cube root, as two words. */
function rootFraction(prime: number, power: 2 | 3): [number, number] {
  const scaled = integerRoot(BigInt(prime) << BigInt(64 * power), power) & 0xffffffffffffffffn;
  return [Number(scaled >> 32n) | 0, Number(scaled & 0xffffffffn) | 0];
}

interface Constants {
  /** Round constants: 80 pairs of words; SHA-256 uses the high word of the first 64. */
  readonly k: Int32Array;
  readonly init256: Int32Array;
  readonly init384: Int32Array;
  readonly init512: Int32Array;
}

let constants: Constants | undefined;

/** The standard's constants are roots of primes; working them out is shorter than listing them. */
function getConstants(): Constants {
  if (constants) return constants;
  const k = new Int32Array(160);
  PRIMES.forEach((prime, i) => {
    k.set(rootFraction(prime, 3), i * 2);
  });
  const roots = (from: number): Int32Array => {
    const words = new Int32Array(16);
    for (let i = 0; i < 8; i++) words.set(rootFraction(PRIMES[from + i] as number, 2), i * 2);
    return words;
  };
  const init512 = roots(0);
  constants = {
    k,
    init512,
    init384: roots(8),
    init256: init512.filter((_word, i) => i % 2 === 0),
  };
  return constants;
}

/** Appends the padding and the message length, to a whole number of blocks. */
function pad(data: Uint8Array, block: 64 | 128): Uint8Array {
  const lengthBytes = block / 8;
  const size = Math.ceil((data.length + 1 + lengthBytes) / block) * block;
  const padded = new Uint8Array(size);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(size - 8, Math.floor(data.length / 0x20000000));
  view.setUint32(size - 4, (data.length << 3) >>> 0);
  return padded;
}

export function sha256(data: Uint8Array): Uint8Array {
  const { k, init256 } = getConstants();
  const state = Int32Array.from(init256);
  const padded = pad(data, 64);
  const view = new DataView(padded.buffer);
  const w = new Int32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = state as unknown as number[] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + s1 + ((e & f) ^ (~e & g)) + (k[i * 2] as number) + (w[i] as number)) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const sums = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) state[i] = ((state[i] as number) + (sums[i] as number)) | 0;
  }
  const out = new Uint8Array(32);
  const result = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) result.setInt32(i * 4, state[i] as number);
  return out;
}

/**
 * SHA-512 and SHA-384, which differ only in their starting state and how much of the result
 * is kept. Each 64-bit word is held as two 32-bit halves, and sums are built up in 16-bit
 * pieces so that no carry is lost. The loop is written out flat because it is the slow part
 * of opening a password: it runs over about a megabyte per password.
 */
function sha512Family(data: Uint8Array, init: Int32Array, length: number): Uint8Array {
  const { k } = getConstants();
  const state = Int32Array.from(init);
  const padded = pad(data, 128);
  const view = new DataView(padded.buffer);
  const w = new Int32Array(160);
  for (let offset = 0; offset < padded.length; offset += 128) {
    for (let i = 0; i < 32; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 32; i < 160; i += 2) {
      const ah = w[i - 30] as number;
      const al = w[i - 29] as number;
      // σ0: rotate right 1, rotate right 8, shift right 7
      const s0h = ((ah >>> 1) | (al << 31)) ^ ((ah >>> 8) | (al << 24)) ^ (ah >>> 7);
      const s0l = ((al >>> 1) | (ah << 31)) ^ ((al >>> 8) | (ah << 24)) ^ ((al >>> 7) | (ah << 25));
      const bh = w[i - 4] as number;
      const bl = w[i - 3] as number;
      // σ1: rotate right 19, rotate right 61, shift right 6
      const s1h = ((bh >>> 19) | (bl << 13)) ^ ((bl >>> 29) | (bh << 3)) ^ (bh >>> 6);
      const s1l =
        ((bl >>> 19) | (bh << 13)) ^ ((bh >>> 29) | (bl << 3)) ^ ((bl >>> 6) | (bh << 26));
      const ch = w[i - 32] as number;
      const cl = w[i - 31] as number;
      const dh = w[i - 14] as number;
      const dl = w[i - 13] as number;
      const p0 = (s0l & 0xffff) + (s1l & 0xffff) + (cl & 0xffff) + (dl & 0xffff);
      let p1 = (s0l >>> 16) + (s1l >>> 16) + (cl >>> 16) + (dl >>> 16);
      let p2 = (s0h & 0xffff) + (s1h & 0xffff) + (ch & 0xffff) + (dh & 0xffff);
      let p3 = (s0h >>> 16) + (s1h >>> 16) + (ch >>> 16) + (dh >>> 16);
      p1 += p0 >>> 16;
      p2 += p1 >>> 16;
      p3 += p2 >>> 16;
      w[i] = ((p3 & 0xffff) << 16) | (p2 & 0xffff);
      w[i + 1] = ((p1 & 0xffff) << 16) | (p0 & 0xffff);
    }
    let ah = state[0] as number;
    let al = state[1] as number;
    let bh = state[2] as number;
    let bl = state[3] as number;
    let ch = state[4] as number;
    let cl = state[5] as number;
    let dh = state[6] as number;
    let dl = state[7] as number;
    let eh = state[8] as number;
    let el = state[9] as number;
    let fh = state[10] as number;
    let fl = state[11] as number;
    let gh = state[12] as number;
    let gl = state[13] as number;
    let hh = state[14] as number;
    let hl = state[15] as number;
    for (let i = 0; i < 160; i += 2) {
      // Σ1(e): rotate right 14, 18, 41
      const s1h =
        ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const s1l =
        ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      const kh = k[i] as number;
      const kl = k[i + 1] as number;
      const wh = w[i] as number;
      const wl = w[i + 1] as number;
      // t1 = h + Σ1 + ch + k + w
      let p0 = (hl & 0xffff) + (s1l & 0xffff) + (chl & 0xffff) + (kl & 0xffff) + (wl & 0xffff);
      let p1 = (hl >>> 16) + (s1l >>> 16) + (chl >>> 16) + (kl >>> 16) + (wl >>> 16);
      let p2 = (hh & 0xffff) + (s1h & 0xffff) + (chh & 0xffff) + (kh & 0xffff) + (wh & 0xffff);
      let p3 = (hh >>> 16) + (s1h >>> 16) + (chh >>> 16) + (kh >>> 16) + (wh >>> 16);
      p1 += p0 >>> 16;
      p2 += p1 >>> 16;
      p3 += p2 >>> 16;
      const t1h = ((p3 & 0xffff) << 16) | (p2 & 0xffff);
      const t1l = ((p1 & 0xffff) << 16) | (p0 & 0xffff);
      // Σ0(a): rotate right 28, 34, 39
      const s0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const s0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      // e = d + t1
      p0 = (dl & 0xffff) + (t1l & 0xffff);
      p1 = (dl >>> 16) + (t1l >>> 16) + (p0 >>> 16);
      p2 = (dh & 0xffff) + (t1h & 0xffff) + (p1 >>> 16);
      p3 = (dh >>> 16) + (t1h >>> 16) + (p2 >>> 16);
      eh = ((p3 & 0xffff) << 16) | (p2 & 0xffff);
      el = ((p1 & 0xffff) << 16) | (p0 & 0xffff);
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      // a = t1 + Σ0 + maj
      p0 = (t1l & 0xffff) + (s0l & 0xffff) + (majl & 0xffff);
      p1 = (t1l >>> 16) + (s0l >>> 16) + (majl >>> 16) + (p0 >>> 16);
      p2 = (t1h & 0xffff) + (s0h & 0xffff) + (majh & 0xffff) + (p1 >>> 16);
      p3 = (t1h >>> 16) + (s0h >>> 16) + (majh >>> 16) + (p2 >>> 16);
      ah = ((p3 & 0xffff) << 16) | (p2 & 0xffff);
      al = ((p1 & 0xffff) << 16) | (p0 & 0xffff);
    }
    add64(state, 0, ah, al);
    add64(state, 2, bh, bl);
    add64(state, 4, ch, cl);
    add64(state, 6, dh, dl);
    add64(state, 8, eh, el);
    add64(state, 10, fh, fl);
    add64(state, 12, gh, gl);
    add64(state, 14, hh, hl);
  }
  const out = new Uint8Array(64);
  const result = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) result.setInt32(i * 4, state[i] as number);
  return out.subarray(0, length);
}

/** Adds a 64-bit number, given as high and low halves, to the one at `target[at]`. */
function add64(target: Int32Array, at: number, high: number, low: number): void {
  const th = target[at] as number;
  const tl = target[at + 1] as number;
  const p0 = (tl & 0xffff) + (low & 0xffff);
  const p1 = (tl >>> 16) + (low >>> 16) + (p0 >>> 16);
  const p2 = (th & 0xffff) + (high & 0xffff) + (p1 >>> 16);
  const p3 = (th >>> 16) + (high >>> 16) + (p2 >>> 16);
  target[at] = ((p3 & 0xffff) << 16) | (p2 & 0xffff);
  target[at + 1] = ((p1 & 0xffff) << 16) | (p0 & 0xffff);
}

export function sha384(data: Uint8Array): Uint8Array {
  return sha512Family(data, getConstants().init384, 48);
}

export function sha512(data: Uint8Array): Uint8Array {
  return sha512Family(data, getConstants().init512, 64);
}

// ----- AES (FIPS 197), encryption only -----

interface AesTables {
  readonly sbox: Uint8Array;
  /** The round transformation for each byte position, as four lookup tables. */
  readonly t: readonly [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
}

let aesTables: AesTables | undefined;

function getAesTables(): AesTables {
  if (aesTables) return aesTables;
  // The S-box: the inverse in GF(2^8), then an affine map. Walk the field by powers of 3.
  const sbox = new Uint8Array(256);
  let p = 1;
  let q = 1;
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff; // multiply by 3
    // divide by 3
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x =
      q ^
      ((q << 1) | (q >> 7)) ^
      ((q << 2) | (q >> 6)) ^
      ((q << 3) | (q >> 5)) ^
      ((q << 4) | (q >> 4));
    sbox[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  sbox[0] = 0x63;
  const t0 = new Uint32Array(256);
  const t1 = new Uint32Array(256);
  const t2 = new Uint32Array(256);
  const t3 = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const s = sbox[i] as number;
    const s2 = ((s << 1) ^ (s & 0x80 ? 0x11b : 0)) & 0xff;
    const s3 = s2 ^ s;
    const word = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    t0[i] = word;
    t1[i] = ((word >>> 8) | (word << 24)) >>> 0;
    t2[i] = ((word >>> 16) | (word << 16)) >>> 0;
    t3[i] = ((word >>> 24) | (word << 8)) >>> 0;
  }
  aesTables = { sbox, t: [t0, t1, t2, t3] };
  return aesTables;
}

/** An AES key prepared for encrypting: 128 bits (16 bytes) or 256 bits (32 bytes). */
export class AesKey {
  readonly #words: Uint32Array;
  readonly #rounds: number;
  #viewed: [Uint8Array | undefined, Uint8Array | undefined] = [undefined, undefined];
  #views: [DataView | undefined, DataView | undefined] = [undefined, undefined];

  constructor(key: Uint8Array) {
    if (key.length !== 16 && key.length !== 32) throw new RangeError("AES keys are 16 or 32 bytes");
    const { sbox } = getAesTables();
    const nk = key.length / 4;
    this.#rounds = nk + 6;
    const words = new Uint32Array(4 * (this.#rounds + 1));
    const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
    for (let i = 0; i < nk; i++) words[i] = view.getUint32(i * 4);
    const sub = (word: number): number =>
      (((sbox[word >>> 24] as number) << 24) |
        ((sbox[(word >>> 16) & 0xff] as number) << 16) |
        ((sbox[(word >>> 8) & 0xff] as number) << 8) |
        (sbox[word & 0xff] as number)) >>>
      0;
    let rcon = 1;
    for (let i = nk; i < words.length; i++) {
      let word = words[i - 1] as number;
      if (i % nk === 0) {
        word = (sub(((word << 8) | (word >>> 24)) >>> 0) ^ (rcon << 24)) >>> 0;
        rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 0xff;
      } else if (nk > 6 && i % nk === 4) word = sub(word);
      words[i] = ((words[i - nk] as number) ^ word) >>> 0;
    }
    this.#words = words;
  }

  /** Encrypts the 16 bytes at `input[at]` into `output[at]`, after XOR with `chain` if given. */
  #block(input: Uint8Array, output: Uint8Array, at: number, chain: Uint32Array | undefined): void {
    const { sbox, t } = getAesTables();
    const [t0, t1, t2, t3] = t;
    const k = this.#words;
    const view = this.#view(input);
    let s0 = view.getUint32(at) ^ (k[0] as number);
    let s1 = view.getUint32(at + 4) ^ (k[1] as number);
    let s2 = view.getUint32(at + 8) ^ (k[2] as number);
    let s3 = view.getUint32(at + 12) ^ (k[3] as number);
    if (chain) {
      s0 ^= chain[0] as number;
      s1 ^= chain[1] as number;
      s2 ^= chain[2] as number;
      s3 ^= chain[3] as number;
    }
    let r = 4;
    for (let round = 1; round < this.#rounds; round++) {
      const n0 =
        (t0[s0 >>> 24] as number) ^
        (t1[(s1 >>> 16) & 0xff] as number) ^
        (t2[(s2 >>> 8) & 0xff] as number) ^
        (t3[s3 & 0xff] as number) ^
        (k[r] as number);
      const n1 =
        (t0[s1 >>> 24] as number) ^
        (t1[(s2 >>> 16) & 0xff] as number) ^
        (t2[(s3 >>> 8) & 0xff] as number) ^
        (t3[s0 & 0xff] as number) ^
        (k[r + 1] as number);
      const n2 =
        (t0[s2 >>> 24] as number) ^
        (t1[(s3 >>> 16) & 0xff] as number) ^
        (t2[(s0 >>> 8) & 0xff] as number) ^
        (t3[s1 & 0xff] as number) ^
        (k[r + 2] as number);
      s3 =
        (t0[s3 >>> 24] as number) ^
        (t1[(s0 >>> 16) & 0xff] as number) ^
        (t2[(s1 >>> 8) & 0xff] as number) ^
        (t3[s2 & 0xff] as number) ^
        (k[r + 3] as number);
      s0 = n0;
      s1 = n1;
      s2 = n2;
      r += 4;
    }
    // The last round has no column mixing.
    const o0 =
      (((sbox[s0 >>> 24] as number) << 24) |
        ((sbox[(s1 >>> 16) & 0xff] as number) << 16) |
        ((sbox[(s2 >>> 8) & 0xff] as number) << 8) |
        (sbox[s3 & 0xff] as number)) ^
      (k[r] as number);
    const o1 =
      (((sbox[s1 >>> 24] as number) << 24) |
        ((sbox[(s2 >>> 16) & 0xff] as number) << 16) |
        ((sbox[(s3 >>> 8) & 0xff] as number) << 8) |
        (sbox[s0 & 0xff] as number)) ^
      (k[r + 1] as number);
    const o2 =
      (((sbox[s2 >>> 24] as number) << 24) |
        ((sbox[(s3 >>> 16) & 0xff] as number) << 16) |
        ((sbox[(s0 >>> 8) & 0xff] as number) << 8) |
        (sbox[s1 & 0xff] as number)) ^
      (k[r + 2] as number);
    const o3 =
      (((sbox[s3 >>> 24] as number) << 24) |
        ((sbox[(s0 >>> 16) & 0xff] as number) << 16) |
        ((sbox[(s1 >>> 8) & 0xff] as number) << 8) |
        (sbox[s2 & 0xff] as number)) ^
      (k[r + 3] as number);
    const out = this.#view(output);
    out.setInt32(at, o0);
    out.setInt32(at + 4, o1);
    out.setInt32(at + 8, o2);
    out.setInt32(at + 12, o3);
    if (chain) {
      chain[0] = o0;
      chain[1] = o1;
      chain[2] = o2;
      chain[3] = o3;
    }
  }

  /** A view of a buffer, kept between blocks: making one per block would dominate the cost. */
  #view(bytes: Uint8Array): DataView {
    if (this.#viewed[0] === bytes) return this.#views[0] as DataView;
    if (this.#viewed[1] === bytes) return this.#views[1] as DataView;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#viewed = [bytes, this.#viewed[0]];
    this.#views = [view, this.#views[0]];
    return view;
  }

  /** Encrypts one 16-byte block on its own (ECB). */
  encryptBlock(block: Uint8Array): Uint8Array {
    const out = new Uint8Array(16);
    this.#block(block, out, 0, undefined);
    return out;
  }

  /**
   * Encrypts in CBC mode. With `padding`, the data is padded to a whole number of blocks as
   * PKCS #7 does (always adding at least one byte); without, its length must already be a
   * multiple of 16. The result does not include the initialisation vector.
   */
  encryptCbc(data: Uint8Array, iv: Uint8Array, padding: boolean): Uint8Array {
    let input = data;
    if (padding) {
      const fill = 16 - (data.length % 16);
      input = new Uint8Array(data.length + fill);
      input.set(data);
      input.fill(fill, data.length);
    } else if (data.length % 16 !== 0) {
      throw new RangeError("Without padding the data must be a whole number of blocks");
    }
    const view = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
    const chain = Uint32Array.of(
      view.getUint32(0),
      view.getUint32(4),
      view.getUint32(8),
      view.getUint32(12),
    );
    const out = new Uint8Array(input.length);
    for (let at = 0; at < input.length; at += 16) this.#block(input, out, at, chain);
    return out;
  }
}
