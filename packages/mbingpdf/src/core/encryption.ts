/**
 * Password protection: the standard security handler of PDF 2.0 with AES-256 (ISO 32000-2,
 * 7.6.4, "revision 6"). Every string and stream in the file is encrypted with one random key,
 * and the key is stored twice, locked once with each password.
 */
import { AesKey, sha256, sha384, sha512 } from "./crypto.ts";
import { PdfDict, PdfName, PdfString } from "./objects.ts";

/** What someone who opens the file with the user password may do. All default to true. */
export interface PdfPermissions {
  /** Printing. `"low"` allows only a degraded print, not one fit for reproduction. */
  print?: boolean | "low";
  /** Changing the content. */
  modify?: boolean;
  /** Copying text and pictures out. Screen readers may always read the text. */
  copy?: boolean;
  /** Adding comments and filling form fields. */
  annotate?: boolean;
  /** Filling form fields, even where `annotate` is false. */
  fillForms?: boolean;
  /** Inserting, deleting and turning pages. */
  assemble?: boolean;
}

export interface PdfEncryptionOptions {
  /** The password needed to open the file. Without one the file opens for anyone. */
  userPassword?: string;
  /**
   * The password that opens the file with every restriction lifted. When left out, a random
   * one is used that nobody knows, so the restrictions cannot be lifted.
   */
  ownerPassword?: string;
  /**
   * What is allowed after opening with the user password. Viewers honour these by
   * convention; they do not stop someone determined.
   */
  permissions?: PdfPermissions;
}

/** Encrypts the parts of a file as they are written. */
export interface PdfEncryptor {
  /** The encryption dictionary, to be written unencrypted and named in the trailer. */
  readonly dict: PdfDict;
  /** Encrypts the bytes of a string or a stream. */
  encrypt(data: Uint8Array): Uint8Array;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A password as the standard wants it: normalised, UTF-8, at most 127 bytes. */
function passwordBytes(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize("NFKC")).subarray(0, 127);
}

/**
 * The hash that turns a password into a key (algorithm 2.B): deliberately slow, mixing three
 * hash functions and AES for at least 64 rounds.
 */
function passwordHash(password: Uint8Array, salt: Uint8Array, userKey: Uint8Array): Uint8Array {
  let k = sha256(concat(password, salt, userKey));
  for (let round = 0; ; round++) {
    const piece = concat(password, k, userKey);
    const repeated = new Uint8Array(piece.length * 64);
    for (let i = 0; i < 64; i++) repeated.set(piece, i * piece.length);
    const e = new AesKey(k.subarray(0, 16)).encryptCbc(repeated, k.subarray(16, 32), false);
    // The first 16 bytes as one big number, modulo 3; 256 leaves 1, so the digits just add.
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i] as number;
    k = sum % 3 === 0 ? sha256(e) : sum % 3 === 1 ? sha384(e) : sha512(e);
    if (round >= 63 && (e.at(-1) as number) <= round - 31) break;
  }
  return k.subarray(0, 32);
}

/** A source of bytes nobody can predict, or, for reproducible files, one that only looks it. */
function randomSource(seed: Uint8Array | undefined): (length: number) => Uint8Array {
  if (!seed) {
    return (length) => {
      const bytes = new Uint8Array(length);
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    };
  }
  let state = sha256(seed);
  return (length) => {
    const bytes = new Uint8Array(length);
    for (let at = 0; at < length; at += 32) {
      state = sha256(state);
      bytes.set(state.subarray(0, Math.min(32, length - at)), at);
    }
    return bytes;
  };
}

/**
 * Sets up the encryption of one file.
 *
 * @param deterministic derive every "random" value from the passwords and the content, so the
 *   same input gives the same file. Such files show when two of them hold the same content;
 *   meant for tests.
 */
export function createEncryptor(
  options: PdfEncryptionOptions,
  deterministic: boolean,
): PdfEncryptor {
  const permissions = options.permissions ?? {};
  // Bits 3–6 and 9–12 are the permissions; 7, 8 and 13–32 are always set, 1 and 2 never.
  let p = 0xfffff0c0 | 512; // bit 10, reading for accessibility, is always allowed
  if (permissions.print !== false) p |= 4;
  if (permissions.print === undefined || permissions.print === true) p |= 2048;
  if (permissions.modify !== false) p |= 8;
  if (permissions.copy !== false) p |= 16;
  if (permissions.annotate !== false) p |= 32;
  if (permissions.fillForms !== false) p |= 256;
  if (permissions.assemble !== false) p |= 1024;

  const user = passwordBytes(options.userPassword ?? "");
  const random = randomSource(
    deterministic
      ? concat(
          user,
          Uint8Array.of(0),
          passwordBytes(options.ownerPassword ?? ""),
          Uint8Array.of(p & 0xff, (p >> 8) & 0xff),
        )
      : undefined,
  );
  const owner =
    options.ownerPassword === undefined ? random(32) : passwordBytes(options.ownerPassword);
  const fileKey = random(32);
  const zero = new Uint8Array(16);
  const none = new Uint8Array(0);

  // Each password gets a check value (to recognise it) and a wrapped copy of the file key.
  const userSalts = random(16);
  const u = concat(passwordHash(user, userSalts.subarray(0, 8), none), userSalts);
  const ue = new AesKey(passwordHash(user, userSalts.subarray(8), none)).encryptCbc(
    fileKey,
    zero,
    false,
  );
  const ownerSalts = random(16);
  const o = concat(passwordHash(owner, ownerSalts.subarray(0, 8), u), ownerSalts);
  const oe = new AesKey(passwordHash(owner, ownerSalts.subarray(8), u)).encryptCbc(
    fileKey,
    zero,
    false,
  );

  const key = new AesKey(fileKey);
  // The permissions again, encrypted with the file key, so that changing /P is noticed.
  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, p | 0, true);
  perms.fill(0xff, 4, 8);
  perms.set([0x54, 0x61, 0x64, 0x62], 8); // "T" (metadata is encrypted), then "adb"
  perms.set(random(4), 12);

  const filter = new PdfDict({
    CFM: new PdfName("AESV3"),
    AuthEvent: new PdfName("DocOpen"),
    Length: 32,
  });
  const dict = new PdfDict({
    Filter: new PdfName("Standard"),
    V: 5,
    R: 6,
    Length: 256,
    CF: new PdfDict({ StdCF: filter }),
    StmF: new PdfName("StdCF"),
    StrF: new PdfName("StdCF"),
    O: new PdfString(o, true),
    U: new PdfString(u, true),
    OE: new PdfString(oe, true),
    UE: new PdfString(ue, true),
    Perms: new PdfString(key.encryptBlock(perms), true),
    P: p | 0,
  });

  let counter = 0;
  return {
    dict,
    encrypt(data) {
      // Each string and stream starts from its own initialisation vector, stored in front.
      const iv = deterministic
        ? sha256(
            concat(fileKey, Uint8Array.of(counter++ & 0xff, (counter >> 8) & 0xff), data),
          ).subarray(0, 16)
        : random(16);
      return concat(iv, key.encryptCbc(data, iv, true));
    },
  };
}
