/**
 * A fast 128-bit non-cryptographic hash, used only to derive the file identifier. The
 * identifier must be reproducible on every runtime without async APIs, which rules out
 * `crypto.subtle`; it does not need to resist deliberate collisions.
 */
export class Hash128 {
  #a = 0x9e3779b1;
  #b = 0x85ebca6b;
  #c = 0xc2b2ae35;
  #d = 0x27d4eb2f;
  #length = 0;

  update(data: Uint8Array): void {
    let a = this.#a;
    let b = this.#b;
    let c = this.#c;
    let d = this.#d;
    for (let i = 0; i < data.length; i++) {
      const byte = data[i] as number;
      a = Math.imul(a ^ byte, 0x01000193);
      b = Math.imul(b ^ byte, 0x9e3779b1) ^ (b >>> 15);
      c = Math.imul(c ^ byte, 0x85ebca6b) ^ (c >>> 13);
      d = Math.imul(d ^ byte, 0xc2b2ae35) ^ (d >>> 16);
    }
    this.#a = a;
    this.#b = b;
    this.#c = c;
    this.#d = d;
    this.#length += data.length;
  }

  digest(): Uint8Array {
    const out = new Uint8Array(16);
    const lanes = [this.#a, this.#b, this.#c, this.#d];
    for (let i = 0; i < 4; i++) {
      // murmur3 finaliser, with the length and the neighbouring lane mixed in
      let h = (lanes[i] as number) ^ this.#length ^ Math.imul(lanes[(i + 1) % 4] as number, 31);
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      h ^= h >>> 16;
      out[i * 4] = h >>> 24;
      out[i * 4 + 1] = (h >>> 16) & 0xff;
      out[i * 4 + 2] = (h >>> 8) & 0xff;
      out[i * 4 + 3] = h & 0xff;
    }
    return out;
  }
}
