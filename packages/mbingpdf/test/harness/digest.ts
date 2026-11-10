/**
 * SHA-256 of every sample document. The output of the library must be byte-identical on every
 * runtime, so these digests are compared with `test/golden/digests.json` on Node, Bun, Deno and
 * in a browser. Uses only APIs present in all of them.
 */
import { type CoreModule, samples } from "./samples.ts";

export async function digestSamples(core: CoreModule): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const [name, sample] of Object.entries(samples)) {
    const pdf = sample.build(core);
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
