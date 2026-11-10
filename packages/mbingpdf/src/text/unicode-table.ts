/** A per-code-point property, decoded from the run-length strings in `unicode-data.ts`. */
export class UnicodeTable {
  readonly #starts: Uint32Array;
  readonly #values: Uint8Array;
  /** Direct lookup for the first 256 code points, which are most of what Latin text uses. */
  readonly #latin: Uint8Array = new Uint8Array(256);

  constructor(data: string) {
    const starts: number[] = [];
    const values: number[] = [];
    let code = 0;
    let length = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      if (char >= 0x30 && char <= 0x39) {
        length = length * 10 + char - 0x30;
        continue;
      }
      starts.push(code);
      // "A"–"Z" are 0–25, "a"–"z" are 26–51.
      values.push(char <= 0x5a ? char - 0x41 : char - 0x61 + 26);
      code += length;
      length = 0;
    }
    this.#starts = Uint32Array.from(starts);
    this.#values = Uint8Array.from(values);
    for (let i = 0; i < 256; i++) this.#latin[i] = this.#search(i);
  }

  /** The index of the code point's class in the table's list of class names. */
  get(codePoint: number): number {
    return codePoint < 256 ? (this.#latin[codePoint] as number) : this.#search(codePoint);
  }

  #search(codePoint: number): number {
    const starts = this.#starts;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] as number) <= codePoint) low = mid;
      else high = mid - 1;
    }
    return this.#values[low] as number;
  }
}
