// Cross-runtime check: builds every sample with the *built* package and compares the SHA-256
// of each file with the approved digests. Run it with Node, Bun or Deno after `pnpm build`:
//
//   node test/harness/runtime.mjs
//   bun  test/harness/runtime.mjs
//   deno run --allow-read test/harness/runtime.mjs
import { readFile } from "node:fs/promises";
import * as core from "../../dist/core/index.js";
import * as font from "../../dist/font/index.js";
import golden from "../golden/digests.json" with { type: "json" };
import { compareDigests, digestSamples } from "./digest.ts";
import { FONT_FILES } from "./samples.ts";

const runtime =
  typeof Deno !== "undefined"
    ? `Deno ${Deno.version.deno}`
    : typeof Bun !== "undefined"
      ? `Bun ${Bun.version}`
      : `Node ${process.versions.node}`;

const fonts = {};
for (const file of FONT_FILES) {
  // Wrap in a plain Uint8Array: what Node and Bun return here is a Buffer.
  fonts[file] = new Uint8Array(await readFile(new URL(`../fonts/${file}.ttf`, import.meta.url)));
}

const actual = await digestSamples({ core, font, fonts });
const different = compareDigests(actual, golden);
if (different.length > 0) {
  for (const name of different) {
    console.error(`${name}: expected ${golden[name]}, got ${actual[name]}`);
  }
  throw new Error(
    `${runtime}: output differs from the approved digests for ${different.join(", ")}`,
  );
}
console.log(`${runtime}: ${Object.keys(actual).length} samples match the approved digests`);
