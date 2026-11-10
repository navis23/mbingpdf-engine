/** Growable byte buffer used to build PDF syntax. */
export class ByteWriter {
  #buffer: Uint8Array = new Uint8Array(256);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  /** The last byte written, or -1 when empty. */
  get last(): number {
    return this.#length === 0 ? -1 : (this.#buffer[this.#length - 1] as number);
  }

  byte(value: number): void {
    this.#reserve(1);
    this.#buffer[this.#length++] = value;
  }

  /** Writes a string whose characters are all in the range 0–255, one byte each. */
  ascii(text: string): void {
    this.#reserve(text.length);
    for (let i = 0; i < text.length; i++) {
      this.#buffer[this.#length++] = text.charCodeAt(i);
    }
  }

  bytes(data: Uint8Array): void {
    this.#reserve(data.length);
    this.#buffer.set(data, this.#length);
    this.#length += data.length;
  }

  /** Returns a copy of what has been written. */
  toBytes(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }

  #reserve(extra: number): void {
    const needed = this.#length + extra;
    if (needed <= this.#buffer.length) return;
    const next = new Uint8Array(Math.max(needed, this.#buffer.length * 2));
    next.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = next;
  }
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
