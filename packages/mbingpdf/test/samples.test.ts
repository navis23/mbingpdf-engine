import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compareDigests, digestSamples } from "./harness/digest.ts";
import { env } from "./harness/env.ts";
import { readGoldenJson, UPDATE_GOLDEN, writeGoldenJson } from "./harness/golden.ts";
import { extractText } from "./harness/render.ts";
import { samples } from "./harness/samples.ts";

const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;
const names = Object.keys(samples);
const build = (name: string): Uint8Array => (samples[name] as (typeof samples)[string]).build(env);

/** pdf.js splits text into runs differently per font; compare the words, not the runs. */
const words = (runs: readonly string[]): string => runs.join(" ").replace(/\s+/g, " ").trim();

describe("samples", () => {
  test("every sample is deterministic", () => {
    for (const name of names) expect(build(name)).toEqual(build(name));
  });

  test("output bytes match the approved digests", async () => {
    const actual = await digestSamples(env);
    if (UPDATE_GOLDEN) {
      writeGoldenJson("digests.json", actual);
      return;
    }
    const expected = readGoldenJson<Record<string, string>>("digests.json");
    expect(expected, "test/golden/digests.json is missing; run with UPDATE_GOLDEN=1").toBeDefined();
    expect(
      compareDigests(actual, expected ?? {}),
      "Output bytes changed. If that is intended, review the visual diffs and run with UPDATE_GOLDEN=1.",
    ).toEqual([]);
  });

  test.skipIf(!hasQpdf).each(names)("qpdf --check passes: %s", (name) => {
    const dir = mkdtempSync(join(tmpdir(), "mbingpdf-"));
    try {
      const file = join(dir, `${name}.pdf`);
      writeFileSync(file, build(name));
      const result = spawnSync("qpdf", ["--check", file], { encoding: "utf8" });
      const output = result.stdout + result.stderr;
      expect(output).not.toMatch(/^(WARNING|ERROR)/m);
      expect(output).toContain("No syntax or stream encoding errors found");
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each(names)("text can be extracted: %s", async (name) => {
    const sample = samples[name] as (typeof samples)[string];
    const pages = await extractText(build(name));
    expect(pages.length).toBe(sample.text.length);
    pages.forEach((runs, i) => {
      const extracted = words(runs);
      for (const line of sample.text[i] ?? []) expect(extracted).toContain(words([line]));
    });
  });
});
