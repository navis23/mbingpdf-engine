/**
 * The PDF object model (ISO 32000-1, 7.3).
 *
 * Numbers, booleans and null map to their JavaScript counterparts and arrays to JavaScript
 * arrays. Names, strings, dictionaries, streams and indirect references have their own classes.
 */

export type PdfObject =
  | null
  | boolean
  | number
  | PdfName
  | PdfString
  | PdfRef
  | PdfDict
  | PdfStream
  | readonly PdfObject[];

/** A name object such as `/Type`. `value` is the name without the leading slash. */
export class PdfName {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}

/** A string object. Holds raw bytes; use {@link PdfString.text} for human-readable text. */
export class PdfString {
  readonly bytes: Uint8Array;
  /** Write as `<hex>` instead of `(literal)`. */
  readonly hex: boolean;

  constructor(bytes: Uint8Array, hex = false) {
    this.bytes = bytes;
    this.hex = hex;
  }

  /**
   * Encodes a text string (ISO 32000-1, 7.9.2.2): printable ASCII is stored as is, anything
   * else as UTF-16BE with a byte order mark.
   */
  static text(text: string): PdfString {
    let ascii = true;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 0x7e || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      return new PdfString(bytes);
    }
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xfe;
    bytes[1] = 0xff;
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      bytes[2 + i * 2] = unit >> 8;
      bytes[3 + i * 2] = unit & 0xff;
    }
    return new PdfString(bytes);
  }

  /** Encodes a date as `D:YYYYMMDDHHmmSSZ`, always in UTC. */
  static date(date: Date): PdfString {
    if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
    const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
    return PdfString.text(
      `D:${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
        `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`,
    );
  }
}

/** An indirect reference, `num 0 R`. Obtained from a writer; generation is always 0. */
export class PdfRef {
  readonly num: number;

  constructor(num: number) {
    this.num = num;
  }
}

/** A dictionary. Keys are names without the leading slash; insertion order is preserved. */
export class PdfDict {
  readonly #entries: Map<string, PdfObject> = new Map();

  /** Entries whose value is `undefined` are skipped, which keeps optional keys terse. */
  constructor(entries?: Readonly<Record<string, PdfObject | undefined>>) {
    if (entries) {
      for (const [key, value] of Object.entries(entries)) {
        if (value !== undefined) this.#entries.set(key, value);
      }
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): PdfObject | undefined {
    return this.#entries.get(key);
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  set(key: string, value: PdfObject): this {
    this.#entries.set(key, value);
    return this;
  }

  delete(key: string): boolean {
    return this.#entries.delete(key);
  }

  entries(): IterableIterator<[string, PdfObject]> {
    return this.#entries.entries();
  }

  /** A shallow copy. */
  clone(): PdfDict {
    const copy = new PdfDict();
    for (const [key, value] of this.#entries) copy.set(key, value);
    return copy;
  }
}

/**
 * A stream: a dictionary plus bytes. `data` is the unencoded content unless the dictionary
 * already names a `Filter`; the writer sets `Length` and applies compression.
 */
export class PdfStream {
  readonly dict: PdfDict;
  readonly data: Uint8Array;

  constructor(data: Uint8Array, dict: PdfDict = new PdfDict()) {
    this.data = data;
    this.dict = dict;
  }
}

export function name(value: string): PdfName {
  return new PdfName(value);
}

export function str(text: string): PdfString {
  return PdfString.text(text);
}

export function dict(entries?: Readonly<Record<string, PdfObject | undefined>>): PdfDict {
  return new PdfDict(entries);
}
