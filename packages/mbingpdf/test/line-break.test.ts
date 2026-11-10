import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { lineBreaks } from "../src/text/line-break.ts";

/** Parses one line of LineBreakTest.txt: "× 0041 ÷ 0020 ÷" → text and break offsets. */
function parse(line: string): { text: string; breaks: number[] } {
  const tokens = line.split("#")[0]?.trim().split(/\s+/) ?? [];
  let text = "";
  const breaks: number[] = [];
  for (const token of tokens) {
    if (token === "÷") {
      if (text.length > 0) breaks.push(text.length);
    } else if (token !== "×") {
      text += String.fromCodePoint(Number.parseInt(token, 16));
    }
  }
  return { text, breaks };
}

describe("line breaking (UAX #14)", () => {
  test("passes the Unicode conformance tests", () => {
    const file = gunzipSync(
      readFileSync(new URL("./unicode/LineBreakTest.txt.gz", import.meta.url)),
    );
    const lines = file
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(lines.length).toBeGreaterThan(19000);
    const failures: string[] = [];
    for (const line of lines) {
      const { text, breaks } = parse(line);
      const actual = lineBreaks(text).map((opportunity) => opportunity.offset);
      if (actual.join(",") !== breaks.join(","))
        failures.push(`${line}\n   got ${actual.join(",")}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(failures.length).toBe(0);
  });

  test("ordinary text breaks after spaces and hyphens", () => {
    const text = "Total tagihan: Rp 1.250.000 (lunas) — terima-kasih!";
    const pieces: string[] = [];
    let start = 0;
    for (const { offset } of lineBreaks(text)) {
      pieces.push(text.slice(start, offset));
      start = offset;
    }
    expect(pieces).toEqual([
      "Total ",
      "tagihan: ",
      "Rp ",
      "1.250.000 ",
      "(lunas) ",
      "— ",
      "terima-",
      "kasih!",
    ]);
  });

  test("line feeds are mandatory breaks", () => {
    expect(lineBreaks("a\nb\r\nc")).toEqual([
      { offset: 2, mandatory: true },
      { offset: 5, mandatory: true },
      { offset: 6, mandatory: true },
    ]);
    expect(lineBreaks("")).toEqual([]);
    expect(lineBreaks("a\n")).toEqual([{ offset: 2, mandatory: true }]);
  });

  test("non-breaking spaces and word joiners hold text together", () => {
    expect(lineBreaks("Rp 1.000 x").map((b) => b.offset)).toEqual([9, 10]);
    expect(lineBreaks("a-⁠b").map((b) => b.offset)).toEqual([4]);
  });

  test("a soft hyphen is a break opportunity", () => {
    expect(lineBreaks("ke­be­rang­kat­an").map((b) => b.offset)).toEqual([3, 6, 11, 15, 17]);
  });
});
