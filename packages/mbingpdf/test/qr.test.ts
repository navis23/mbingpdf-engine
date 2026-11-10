import jsQR from "jsqr";
import { describe, expect, test } from "vitest";
import { type QrLevel, type QrMatrix, qrCode } from "../src/qr/index.ts";

/** Draws a code as an image, eight pixels per module with a quiet zone, and reads it back. */
function scan(code: QrMatrix): string | undefined {
  const scale = 8;
  const quiet = 4;
  const side = (code.size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.modules[y]?.[x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const at = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
        }
      }
    }
  }
  return jsQR(pixels, side, side)?.data;
}

describe("QR codes", () => {
  test("a short text gives the smallest code", () => {
    const code = qrCode("BIB:0421");
    expect(code.version).toBe(1);
    expect(code.size).toBe(21);
    expect(code.modules).toHaveLength(21);
    // The three finder patterns: dark corners, and the fourth corner free.
    expect(code.modules[0]?.[0]).toBe(true);
    expect(code.modules[0]?.[20]).toBe(true);
    expect(code.modules[20]?.[0]).toBe(true);
    expect(scan(code)).toBe("BIB:0421");
  });

  test.each(["L", "M", "Q", "H"] as QrLevel[])(
    "codes of every size read back correctly at level %s",
    (level) => {
      // Lengths chosen to walk through small, medium and large versions, across the points
      // where the layout changes (alignment patterns from 2, version information from 7).
      const seen = new Set<number>();
      for (const length of [1, 10, 20, 40, 70, 110, 160, 250, 400, 700, 1000]) {
        const text = Array.from({ length }, (_value, i) =>
          String.fromCharCode(33 + ((i * 7) % 90)),
        ).join("");
        const code = qrCode(text, { level });
        seen.add(code.version);
        expect(scan(code), `level ${level}, ${length} characters, version ${code.version}`).toBe(
          text,
        );
      }
      expect(seen.size).toBeGreaterThan(8);
    },
  );

  test("every version from 1 to 40 reads back", () => {
    for (let version = 1; version <= 40; version++) {
      const code = qrCode(`v${version}`, { minVersion: version });
      expect(code.version).toBe(version);
      expect(code.size).toBe(version * 4 + 17);
      expect(scan(code), `version ${version}`).toBe(`v${version}`);
    }
  });

  test("text outside ASCII is stored as UTF-8", () => {
    const text = "https://contoh.id/peserta/Đặng-Thị-Ánh?é=1 ✔";
    expect(scan(qrCode(text, { level: "Q" }))).toBe(text);
  });

  test("higher error correction needs a larger code", () => {
    const text = "x".repeat(60);
    expect(qrCode(text, { level: "H" }).version).toBeGreaterThan(
      qrCode(text, { level: "L" }).version,
    );
  });

  test("the same text always gives the same code", () => {
    expect(qrCode("sama")).toEqual(qrCode("sama"));
  });

  test("text that cannot fit is an error", () => {
    expect(() => qrCode("x".repeat(3000), { level: "H" })).toThrow(/too long/);
    expect(qrCode("x".repeat(2900), { level: "L" }).version).toBe(40);
  });
});
