/** The hashing and encryption written for PDF passwords, against the runtime's own. */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AesKey, sha256, sha384, sha512 } from "../src/core/crypto.ts";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

describe("SHA-2", () => {
  test("the standard's example", () => {
    const abc = new TextEncoder().encode("abc");
    expect(hex(sha256(abc))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hex(sha384(abc))).toBe(
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    );
    expect(hex(sha512(abc))).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
  });

  test("agrees with the runtime at every length around the block sizes", () => {
    const data = randomBytes(600);
    for (let length = 0; length <= 300; length++) {
      const input = new Uint8Array(data.subarray(0, length));
      expect(hex(sha256(input))).toBe(createHash("sha256").update(input).digest("hex"));
      expect(hex(sha384(input))).toBe(createHash("sha384").update(input).digest("hex"));
      expect(hex(sha512(input))).toBe(createHash("sha512").update(input).digest("hex"));
    }
    const large = new Uint8Array(randomBytes(100_000));
    expect(hex(sha256(large))).toBe(createHash("sha256").update(large).digest("hex"));
    expect(hex(sha512(large))).toBe(createHash("sha512").update(large).digest("hex"));
  });
});

describe("AES", () => {
  test("the standard's example blocks", () => {
    const block = Uint8Array.from(Buffer.from("00112233445566778899aabbccddeeff", "hex"));
    const key128 = Uint8Array.from(Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"));
    expect(hex(new AesKey(key128).encryptBlock(block))).toBe("69c4e0d86a7b0430d8cdb78070b4c55a");
    const key256 = Uint8Array.from(
      Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex"),
    );
    expect(hex(new AesKey(key256).encryptBlock(block))).toBe("8ea2b7ca516745bfeafc49904b496089");
  });

  test("CBC agrees with the runtime, with and without padding", () => {
    for (const size of [16, 32] as const) {
      const algorithm = size === 16 ? "aes-128-cbc" : "aes-256-cbc";
      for (const length of [0, 1, 15, 16, 17, 31, 32, 100, 4096, 5000]) {
        const key = new Uint8Array(randomBytes(size));
        const iv = new Uint8Array(randomBytes(16));
        const data = new Uint8Array(randomBytes(length));
        const cipher = createCipheriv(algorithm, key, iv);
        const expected = Buffer.concat([cipher.update(data), cipher.final()]);
        expect(hex(new AesKey(key).encryptCbc(data, iv, true))).toBe(expected.toString("hex"));
        if (length % 16 === 0) {
          const raw = createCipheriv(algorithm, key, iv).setAutoPadding(false);
          const unpadded = Buffer.concat([raw.update(data), raw.final()]);
          expect(hex(new AesKey(key).encryptCbc(data, iv, false))).toBe(unpadded.toString("hex"));
        }
      }
    }
    expect(() => new AesKey(new Uint8Array(24))).toThrow("16 or 32 bytes");
    expect(() =>
      new AesKey(new Uint8Array(16)).encryptCbc(new Uint8Array(5), new Uint8Array(16), false),
    ).toThrow("whole number of blocks");
  });
});
