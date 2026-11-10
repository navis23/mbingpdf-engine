/** Big-endian reader over a byte array, as used by every sfnt table. */
export class BinaryReader {
  readonly bytes: Uint8Array;
  readonly #view: DataView;
  offset: number;

  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  get length(): number {
    return this.bytes.length;
  }

  seek(offset: number): this {
    this.offset = offset;
    return this;
  }

  skip(count: number): this {
    this.offset += count;
    return this;
  }

  u8(): number {
    return this.#view.getUint8(this.offset++);
  }

  u16(): number {
    const value = this.#view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  i16(): number {
    const value = this.#view.getInt16(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    const value = this.#view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  i32(): number {
    const value = this.#view.getInt32(this.offset);
    this.offset += 4;
    return value;
  }

  /** A 16.16 fixed-point number. */
  fixed(): number {
    return this.i32() / 65536;
  }

  tag(): string {
    return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8());
  }

  u16At(offset: number): number {
    return this.#view.getUint16(offset);
  }

  i16At(offset: number): number {
    return this.#view.getInt16(offset);
  }

  u32At(offset: number): number {
    return this.#view.getUint32(offset);
  }
}

/** Big-endian writer that grows as needed. */
export class BinaryWriter {
  #bytes: Uint8Array = new Uint8Array(1024);
  #view: DataView = new DataView(this.#bytes.buffer);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  u8(value: number): this {
    this.#reserve(1);
    this.#view.setUint8(this.#length, value);
    this.#length += 1;
    return this;
  }

  u16(value: number): this {
    this.#reserve(2);
    this.#view.setUint16(this.#length, value);
    this.#length += 2;
    return this;
  }

  i16(value: number): this {
    this.#reserve(2);
    this.#view.setInt16(this.#length, value);
    this.#length += 2;
    return this;
  }

  u32(value: number): this {
    this.#reserve(4);
    this.#view.setUint32(this.#length, value);
    this.#length += 4;
    return this;
  }

  tag(value: string): this {
    for (let i = 0; i < 4; i++) this.u8(value.charCodeAt(i));
    return this;
  }

  bytes(data: Uint8Array): this {
    this.#reserve(data.length);
    this.#bytes.set(data, this.#length);
    this.#length += data.length;
    return this;
  }

  /** Pads with zeros to a multiple of `size`. */
  align(size: number): this {
    while (this.#length % size !== 0) this.u8(0);
    return this;
  }

  setU32(offset: number, value: number): void {
    this.#view.setUint32(offset, value);
  }

  toBytes(): Uint8Array {
    return this.#bytes.slice(0, this.#length);
  }

  #reserve(extra: number): void {
    const needed = this.#length + extra;
    if (needed <= this.#bytes.length) return;
    const next = new Uint8Array(Math.max(needed, this.#bytes.length * 2));
    next.set(this.#bytes.subarray(0, this.#length));
    this.#bytes = next;
    this.#view = new DataView(next.buffer);
  }
}
