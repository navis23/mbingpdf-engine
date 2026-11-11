/**
 * Builds every sample with the built package inside a browser and returns their digests. Runs
 * unchanged in a page and in a Web Worker: it uses nothing but `fetch` and dynamic `import`.
 */
import { digestSamples, digestWebp } from "./digest.ts";
import { ALL_FONT_FILES, type FontFile, fontFileName, type SampleEnv } from "./samples.ts";

const load = async (path: string): Promise<Uint8Array> => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

export async function runSamples(): Promise<Record<string, string>> {
  const [core, font, text, doc] = await Promise.all([
    import("/dist/core/index.js" as string),
    import("/dist/font/index.js" as string),
    import("/dist/text/index.js" as string),
    import("/dist/index.js" as string),
  ]);
  const fonts = {} as Record<FontFile, Uint8Array>;
  for (const file of ALL_FONT_FILES) fonts[file] = await load(`/test/fonts/${fontFileName(file)}`);
  const photo = await load("/test/images/photo.jpg");
  const icc = await load("/test/icc/CGATS001Compat-v2-micro.icc");
  return digestSamples({ core, font, text, doc, photo, icc, fonts } as SampleEnv);
}

/** Decodes every WebP test file with the built package and returns the digests of the pixels. */
export async function runWebp(names: readonly string[]): Promise<Record<string, string>> {
  const { decodeWebp } = await import("/dist/webp/index.js" as string);
  return digestWebp(decodeWebp, (name) => load(`/test/images/webp/${name}.webp`), names);
}
