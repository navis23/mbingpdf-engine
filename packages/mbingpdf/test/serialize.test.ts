import { describe, expect, test } from "vitest";
import {
  ByteWriter,
  dict,
  formatNumber,
  name,
  type PdfObject,
  PdfRef,
  PdfStream,
  PdfString,
  str,
  writeObject,
} from "../src/core/index.ts";

function serialize(value: PdfObject): string {
  const out = new ByteWriter();
  writeObject(out, value);
  return Array.from(out.toBytes(), (byte) => String.fromCharCode(byte)).join("");
}

describe("formatNumber", () => {
  test.each([
    [0, "0"],
    [-0, "0"],
    [42, "42"],
    [-7, "-7"],
    [1.5, "1.5"],
    [0.1 + 0.2, "0.3"],
    [10.0004, "10"],
    [-0.0004, "0"],
    [1e-7, "0"],
    [123456.789, "123456.789"],
    [1 / 3, "0.333"],
  ])("%f → %s", (input, expected) => {
    expect(formatNumber(input)).toBe(expected);
  });

  test("honours the decimals argument", () => {
    expect(formatNumber(1 / 3, 5)).toBe("0.33333");
  });

  test("rejects values PDF cannot hold", () => {
    expect(() => formatNumber(Number.NaN)).toThrow(RangeError);
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatNumber(2 ** 60)).toThrow(RangeError);
  });
});

describe("writeObject", () => {
  test("primitives", () => {
    expect(serialize(null)).toBe("null");
    expect(serialize(true)).toBe("true");
    expect(serialize(false)).toBe("false");
    expect(serialize(new PdfRef(12))).toBe("12 0 R");
  });

  test("names escape delimiters, white space, # and non-ASCII", () => {
    expect(serialize(name("Type"))).toBe("/Type");
    expect(serialize(name("A B"))).toBe("/A#20B");
    expect(serialize(name("a#b/c(d)"))).toBe("/a#23b#2Fc#28d#29");
    expect(serialize(name("é"))).toBe("/#C3#A9");
  });

  test("literal strings escape backslash, parentheses and CR", () => {
    expect(serialize(str("Hello"))).toBe("(Hello)");
    expect(serialize(str("a(b)c\\d\re"))).toBe("(a\\(b\\)c\\\\d\\re)");
  });

  test("non-ASCII text becomes UTF-16BE with a byte order mark", () => {
    const value = str("é😀");
    expect(Array.from(value.bytes)).toEqual([0xfe, 0xff, 0x00, 0xe9, 0xd8, 0x3d, 0xde, 0x00]);
  });

  test("hex strings", () => {
    expect(serialize(new PdfString(new Uint8Array([0, 0xab, 0xff]), true))).toBe("<00ABFF>");
  });

  test("dates are written in UTC", () => {
    const date = new Date(Date.UTC(2026, 10, 10, 2, 41, 5));
    expect(serialize(PdfString.date(date))).toBe("(D:20261110024105Z)");
    expect(() => PdfString.date(new Date(Number.NaN))).toThrow(RangeError);
  });

  test("arrays and dictionaries use the fewest separators that stay unambiguous", () => {
    expect(serialize([1, 2.5, name("X"), 3, new PdfRef(4), null, true, str("s"), 5])).toBe(
      "[1 2.5/X 3 4 0 R null true(s)5]",
    );
    expect(
      serialize(dict({ Type: name("Page"), Count: 2, Kids: [new PdfRef(1)], Skip: undefined })),
    ).toBe("<</Type/Page/Count 2/Kids[1 0 R]>>");
    expect(serialize(dict({ A: dict({ B: [] }) }))).toBe("<</A<</B[]>>>>");
  });

  test("streams must be indirect", () => {
    expect(() => serialize([new PdfStream(new Uint8Array())])).toThrow(TypeError);
  });
});
