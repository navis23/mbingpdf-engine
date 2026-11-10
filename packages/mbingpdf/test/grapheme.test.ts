import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { graphemeBreaks, graphemes } from "../src/text/grapheme.ts";

describe("grapheme clusters (UAX #29)", () => {
  test("passes the Unicode conformance tests", () => {
    const lines = readFileSync(new URL("./unicode/GraphemeBreakTest.txt", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(lines.length).toBeGreaterThan(700);
    const failures: string[] = [];
    for (const line of lines) {
      let text = "";
      const breaks: number[] = [];
      for (const token of line.split("#")[0]?.trim().split(/\s+/) ?? []) {
        if (token === "÷") {
          if (text.length > 0) breaks.push(text.length);
        } else if (token !== "×") text += String.fromCodePoint(Number.parseInt(token, 16));
      }
      const actual = graphemeBreaks(text);
      if (actual.join(",") !== breaks.join(","))
        failures.push(`${line}\n   got ${actual.join(",")}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(failures.length).toBe(0);
  });

  test("keeps what a reader sees as one character together", () => {
    expect(graphemes("aéo")).toEqual(["a", "é", "o"]);
    expect(graphemes("🇮🇩🇯🇵")).toEqual(["🇮🇩", "🇯🇵"]);
    expect(graphemes("👨‍👩‍👧x")).toEqual(["👨‍👩‍👧", "x"]);
    expect(graphemes("👍🏽!")).toEqual(["👍🏽", "!"]);
    expect(graphemes("a\r\nb")).toEqual(["a", "\r\n", "b"]);
    expect(graphemes("")).toEqual([]);
  });
});
