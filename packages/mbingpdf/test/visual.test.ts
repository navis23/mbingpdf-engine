import { describe, expect, test } from "vitest";
import { env } from "./harness/env.ts";
import { compareWithGolden } from "./harness/golden.ts";
import { type Renderer, renderPdf } from "./harness/render.ts";
import { samples } from "./harness/samples.ts";

const renderers: Renderer[] = ["pdfjs", "pdfium"];
const cases = Object.keys(samples).flatMap((name) =>
  renderers.map((renderer) => [name, renderer] as const),
);

describe("visual regression", () => {
  test.each(cases)("%s renders as approved in %s", async (name, renderer) => {
    const sample = samples[name] as (typeof samples)[string];
    const pages = await renderPdf(renderer, sample.build(env));
    expect(pages.length).toBe(sample.text.length);
    const failures = pages
      .map((page, i) => compareWithGolden(`${name}.${renderer}.${i + 1}`, page))
      .filter((result) => result.status === "different" || result.status === "missing")
      .map((result) => result.detail);
    expect(failures).toEqual([]);
  });
});
