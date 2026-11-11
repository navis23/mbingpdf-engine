/**
 * SHA-256 of every sample document. The output of the library must be byte-identical on every
 * runtime, so these digests are compared with `test/golden/digests.json` on Node, Bun, Deno and
 * in a browser. Uses only APIs present in all of them.
 */
import { type SampleEnv, samples } from "./samples.ts";

export async function digestSamples(env: SampleEnv): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const [name, sample] of Object.entries(samples)) {
    const pdf = sample.build(env);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", pdf.slice().buffer));
    digests[name] = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return digests;
}

/** Lists the samples whose digest differs from the approved one. */
export function compareDigests(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): string[] {
  const names = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  return [...names].filter((name) => actual[name] !== expected[name]).sort();
}

interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly alpha?: Uint8Array;
}

/**
 * SHA-256 of the RGBA pixels each WebP test file decodes to (opaque where there is no alpha),
 * to compare with the `rgba` values in `test/images/webp/expected.json`.
 */
export async function digestWebp(
  decode: (bytes: Uint8Array) => DecodedImage,
  load: (name: string) => Promise<Uint8Array>,
  names: readonly string[],
): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const name of names) {
    const image = decode(await load(name));
    const pixels = new Uint8Array(image.width * image.height * 4);
    for (let i = 0; i < image.width * image.height; i++) {
      pixels.set(image.data.subarray(i * 3, i * 3 + 3), i * 4);
      pixels[i * 4 + 3] = image.alpha ? (image.alpha[i] as number) : 255;
    }
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", pixels.buffer));
    digests[name] = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return digests;
}

/** The expected WebP digests, by file name, from `test/images/webp/expected.json`. */
export function expectedWebp(
  expected: Readonly<Record<string, { readonly rgba: string }>>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(expected).map(([name, { rgba }]) => [name, rgba]));
}
