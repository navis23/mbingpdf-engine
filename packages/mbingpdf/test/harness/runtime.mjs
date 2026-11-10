// Cross-runtime check: builds every sample with the *built* package and compares the SHA-256
// of each file with the approved digests. Run it with Node, Bun or Deno after `pnpm build`:
//
//   node test/harness/runtime.mjs
//   bun  test/harness/runtime.mjs
//   deno run --allow-read test/harness/runtime.mjs
import { readFile } from "node:fs/promises";
import * as core from "../../dist/core/index.js";
import * as font from "../../dist/font/index.js";
import * as doc from "../../dist/index.js";
import * as text from "../../dist/text/index.js";
import golden from "../golden/digests.json" with { type: "json" };
import { compareDigests, digestSamples } from "./digest.ts";
import { ALL_FONT_FILES, fontFileName } from "./samples.ts";

const runtime =
  typeof Deno !== "undefined"
    ? `Deno ${Deno.version.deno}`
    : typeof Bun !== "undefined"
      ? `Bun ${Bun.version}`
      : `Node ${process.versions.node}`;

const fonts = {};
for (const file of ALL_FONT_FILES) {
  // Wrap in a plain Uint8Array: what Node and Bun return here is a Buffer.
  fonts[file] = new Uint8Array(
    await readFile(new URL(`../fonts/${fontFileName(file)}`, import.meta.url)),
  );
}

const photo = new Uint8Array(await readFile(new URL("../images/photo.jpg", import.meta.url)));

const icc = new Uint8Array(
  await readFile(new URL("../icc/CGATS001Compat-v2-micro.icc", import.meta.url)),
);

const actual = await digestSamples({ core, font, text, doc, photo, icc, fonts });
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
