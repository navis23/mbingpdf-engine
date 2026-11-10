import { zlibSync } from "fflate";
import { ByteWriter, concatBytes } from "./bytes.ts";
import type { PdfEncryptor } from "./encryption.ts";
import { Hash128 } from "./hash.ts";
import { PdfDict, PdfName, type PdfObject, PdfRef, PdfStream, PdfString } from "./objects.ts";
import { writeObject } from "./serialize.ts";

export interface PdfWriterOptions {
  /** PDF version in the header. Default `"1.7"`. */
  version?: "1.7" | "2.0";
  /** Deflate streams when that makes them smaller. Default `true`. */
  compress?: boolean;
  /**
   * `"stream"` (default) writes a cross-reference stream and packs objects into object
   * streams, which gives the smallest file. `"table"` writes the classic plain-text table for
   * very old consumers and for reading the file by eye.
   */
  xref?: "stream" | "table";
  /** Encrypts every string and stream; see `createEncryptor`. */
  encryptor?: PdfEncryptor;
}

export interface PdfTrailer {
  /** The document catalog. */
  root: PdfRef;
  /** The document information dictionary. */
  info?: PdfRef;
}

type Entry =
  | { kind: "direct"; offset: number }
  | { kind: "queued" }
  | { kind: "packed"; stream: number; index: number };

/** How many objects go into one object stream. */
const OBJECT_STREAM_SIZE = 100;

/**
 * Serialises indirect objects into a PDF file.
 *
 * An object is turned into bytes the moment it is set and cannot change afterwards. To refer
 * to an object that is not complete yet (a page tree, for example), {@link allocate} its
 * reference first and {@link set} it later.
 *
 * The writer has no clock and no randomness: the same calls always produce the same bytes.
 */
export class PdfWriter {
  readonly #compress: boolean;
  readonly #packed: boolean;
  readonly #encryptor: PdfEncryptor | undefined;
  /** Encrypts a string that is written outside an object stream. */
  readonly #seal: ((value: PdfString) => PdfString) | undefined;
  readonly #chunks: Uint8Array[] = [];
  readonly #hash: Hash128 = new Hash128();
  /** Indexed by object number. Slot 0 is the head of the free list. */
  readonly #entries: (Entry | undefined)[] = [undefined];
  #queue: { num: number; bytes: Uint8Array }[] = [];
  #offset = 0;
  #finished = false;

  constructor(options: PdfWriterOptions = {}) {
    this.#compress = options.compress ?? true;
    this.#packed = (options.xref ?? "stream") === "stream";
    const encryptor = options.encryptor;
    this.#encryptor = encryptor;
    this.#seal = encryptor
      ? (value) => new PdfString(encryptor.encrypt(value.bytes), true)
      : undefined;
    const header = new ByteWriter();
    header.ascii(`%PDF-${options.version ?? "1.7"}\n%`);
    // Four bytes above 127 tell transfer tools that the file is binary.
    header.bytes(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]));
    header.ascii("\n");
    this.#emit(header.toBytes());
  }

  /** Reserves an object number. The object must be {@link set} before {@link finish}. */
  allocate(): PdfRef {
    this.#assertOpen();
    this.#entries.push(undefined);
    return new PdfRef(this.#entries.length - 1);
  }

  /** Adds an object and returns its reference. */
  add(value: PdfObject): PdfRef {
    const ref = this.allocate();
    this.set(ref, value);
    return ref;
  }

  /**
   * Writes the object for a reference from {@link allocate}. Stream data is not copied when it
   * is stored uncompressed, so do not modify it before {@link finish} returns.
   */
  set(ref: PdfRef, value: PdfObject): void {
    this.#assertOpen();
    const num = ref.num;
    if (!Number.isInteger(num) || num < 1 || num >= this.#entries.length) {
      throw new RangeError(`Object ${num} was not allocated by this writer`);
    }
    if (this.#entries[num] !== undefined) throw new Error(`Object ${num} is already written`);

    if (value instanceof PdfStream) {
      this.#writeStream(num, value.dict, value.data, value.compress);
      return;
    }
    if (this.#packed) {
      // Strings in an object stream are not encrypted one by one: the whole stream is.
      const body = new ByteWriter();
      writeObject(body, value);
      this.#queue.push({ num, bytes: body.toBytes() });
      this.#entries[num] = { kind: "queued" };
      if (this.#queue.length >= OBJECT_STREAM_SIZE) this.#flushQueue();
      return;
    }
    const out = new ByteWriter();
    out.ascii(`${num} 0 obj\n`);
    writeObject(out, value, this.#seal);
    out.ascii("\nendobj\n");
    this.#entries[num] = { kind: "direct", offset: this.#offset };
    this.#emit(out.toBytes());
  }

  /** Writes the cross-reference data and trailer, and returns the complete file. */
  finish(trailer: PdfTrailer): Uint8Array {
    this.#assertOpen();
    this.#flushQueue();
    let encrypt: PdfRef | undefined;
    if (this.#encryptor) {
      // The encryption dictionary is the one object written in the clear and on its own.
      encrypt = this.allocate();
      const out = new ByteWriter();
      out.ascii(`${encrypt.num} 0 obj\n`);
      writeObject(out, this.#encryptor.dict);
      out.ascii("\nendobj\n");
      this.#entries[encrypt.num] = { kind: "direct", offset: this.#offset };
      this.#emit(out.toBytes());
    }
    for (let num = 1; num < this.#entries.length; num++) {
      if (this.#entries[num] === undefined) {
        throw new Error(`Object ${num} was allocated but never written`);
      }
    }
    // The identifier covers every byte before the cross-reference section.
    const id = new PdfString(this.#hash.digest(), true);
    const shared = { Root: trailer.root, Info: trailer.info, ID: [id, id], Encrypt: encrypt };

    let xrefOffset: number;
    if (this.#packed) {
      const self = this.allocate();
      xrefOffset = this.#offset;
      this.#entries[self.num] = { kind: "direct", offset: xrefOffset };
      const size = this.#entries.length;
      const width = byteWidth(xrefOffset);
      const row = 1 + width + 2;
      const data = new Uint8Array(size * row);
      // Object 0: free, next free object 0, generation 65535.
      data[row - 2] = 0xff;
      data[row - 1] = 0xff;
      for (let num = 1; num < size; num++) {
        const entry = this.#entries[num] as Entry;
        const at = num * row;
        if (entry.kind === "direct") {
          data[at] = 1;
          putUint(data, at + 1, width, entry.offset);
        } else if (entry.kind === "packed") {
          data[at] = 2;
          putUint(data, at + 1, width, entry.stream);
          putUint(data, at + 1 + width, 2, entry.index);
        }
      }
      this.#entries[self.num] = undefined;
      this.#writeStream(
        self.num,
        new PdfDict({ Type: new PdfName("XRef"), Size: size, W: [1, width, 2], ...shared }),
        data,
        true,
        // The cross-reference stream is needed to find the key, so it stays readable.
        false,
      );
    } else {
      xrefOffset = this.#offset;
      const size = this.#entries.length;
      const out = new ByteWriter();
      out.ascii(`xref\n0 ${size}\n0000000000 65535 f \n`);
      for (let num = 1; num < size; num++) {
        const entry = this.#entries[num] as Entry;
        if (entry.kind !== "direct") throw new Error("Unreachable: packed object in table mode");
        if (entry.offset > 9_999_999_999) throw new RangeError("File too large for an xref table");
        out.ascii(`${String(entry.offset).padStart(10, "0")} 00000 n \n`);
      }
      out.ascii("trailer\n");
      writeObject(out, new PdfDict({ Size: size, ...shared }));
      out.ascii("\n");
      this.#emit(out.toBytes());
    }

    const tail = new ByteWriter();
    tail.ascii(`startxref\n${xrefOffset}\n%%EOF\n`);
    this.#emit(tail.toBytes());
    this.#finished = true;
    return concatBytes(this.#chunks);
  }

  #assertOpen(): void {
    if (this.#finished) throw new Error("This writer is already finished");
  }

  #emit(bytes: Uint8Array): void {
    this.#chunks.push(bytes);
    this.#hash.update(bytes);
    this.#offset += bytes.length;
  }

  #writeStream(
    num: number,
    sourceDict: PdfDict,
    source: Uint8Array,
    compress = true,
    encrypt = true,
  ): void {
    const dict = sourceDict.clone();
    let data = source;
    if (this.#compress && compress && !dict.has("Filter") && data.length > 0) {
      const deflated = zlibSync(data, { level: 6 });
      if (deflated.length < data.length) {
        data = deflated;
        dict.set("Filter", new PdfName("FlateDecode"));
      }
    }
    const sealed = encrypt && this.#encryptor !== undefined;
    if (sealed) data = (this.#encryptor as PdfEncryptor).encrypt(data);
    dict.set("Length", data.length);

    const head = new ByteWriter();
    head.ascii(`${num} 0 obj\n`);
    writeObject(head, dict, sealed ? this.#seal : undefined);
    head.ascii("\nstream\n");
    const tail = new ByteWriter();
    tail.ascii("\nendstream\nendobj\n");

    this.#entries[num] = { kind: "direct", offset: this.#offset };
    this.#emit(head.toBytes());
    this.#emit(data);
    this.#emit(tail.toBytes());
  }

  /** Packs the queued objects into one object stream (ISO 32000-1, 7.5.7). */
  #flushQueue(): void {
    const queue = this.#queue;
    if (queue.length === 0) return;
    this.#queue = [];
    const stream = this.allocate().num;

    const index = new ByteWriter();
    const body = new ByteWriter();
    queue.forEach((item, i) => {
      index.ascii(`${item.num} ${body.length} `);
      body.bytes(item.bytes);
      body.byte(0x0a);
      this.#entries[item.num] = { kind: "packed", stream, index: i };
    });
    const data = new ByteWriter();
    data.bytes(index.toBytes());
    data.bytes(body.toBytes());

    this.#writeStream(
      stream,
      new PdfDict({ Type: new PdfName("ObjStm"), N: queue.length, First: index.length }),
      data.toBytes(),
    );
  }
}

function byteWidth(value: number): number {
  let width = 1;
  for (let limit = 256; value >= limit; limit *= 256) width++;
  return width;
}

function putUint(target: Uint8Array, at: number, width: number, value: number): void {
  let rest = value;
  for (let i = width - 1; i >= 0; i--) {
    target[at + i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
}
