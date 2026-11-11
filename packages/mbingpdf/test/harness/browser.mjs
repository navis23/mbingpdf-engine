// Cross-runtime check in a real browser: serves the built package, runs the samples in a page
// and compares their digests with the approved ones. Run after `pnpm build`:
//
//   node test/harness/browser.mjs
//
// Uses Playwright's Chromium, or the browser at CHROMIUM_PATH when that is set.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import golden from "../golden/digests.json" with { type: "json" };
import webpExpected from "../images/webp/expected.json" with { type: "json" };
import { compareDigests, expectedWebp } from "./digest.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const TYPES = {
  ".js": "text/javascript",
  ".ts": "text/javascript",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".icc": "application/vnd.iccprofile",
};

const server = createServer(async (request, response) => {
  try {
    const path = normalize(
      join(root, decodeURIComponent(new URL(request.url, "http://x").pathname)),
    );
    if (request.url === "/") {
      response
        .writeHead(200, { "content-type": "text/html" })
        .end("<!doctype html><title>mbingpdf</title>");
      return;
    }
    if (!path.startsWith(root) || path.includes(`${sep}node_modules${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    let body = await readFile(path);
    // Browsers cannot run TypeScript; the harness files only use erasable syntax.
    if (extname(path) === ".ts") body = stripTypeScriptTypes(body.toString("utf8"));
    response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "text/plain" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const systemChromium = ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
const executablePath =
  process.env.CHROMIUM_PATH ?? (existsSync(chromium.executablePath()) ? undefined : systemChromium);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${origin}/`);
  const webpNames = Object.keys(webpExpected);
  const { actual, webp } = await page.evaluate(async (names) => {
    const { runSamples, runWebp } = await import("/test/harness/browser-run.ts");
    return { actual: await runSamples(), webp: await runWebp(names) };
  }, webpNames);
  // The same again inside a Web Worker, where there is no DOM.
  const worker = await page.evaluate(
    (names) =>
      new Promise((resolve, reject) => {
        const instance = new Worker("/test/harness/browser-worker.ts", {
          type: "module",
          name: names.join(","),
        });
        instance.onmessage = (event) => resolve(event.data);
        instance.onerror = (event) => reject(new Error(event.message || "worker failed to start"));
      }),
    webpNames,
  );
  if (worker.error) throw new Error(`Web Worker: ${worker.error}`);
  if (worker.hasDocument) throw new Error("The worker check did not run in a worker");
  if (errors.length > 0) throw new Error(`Page errors: ${errors.join("; ")}`);
  const different = compareDigests(actual, golden);
  const name = `Chromium ${browser.version()}`;
  if (different.length > 0) {
    for (const sample of different) {
      console.error(`${sample}: expected ${golden[sample]}, got ${actual[sample]}`);
    }
    throw new Error(
      `${name}: output differs from the approved digests for ${different.join(", ")}`,
    );
  }
  console.log(`${name}: ${Object.keys(actual).length} samples match the approved digests`);
  const differentInWorker = compareDigests(worker.digests, golden);
  if (differentInWorker.length > 0) {
    throw new Error(`${name} Web Worker: output differs for ${differentInWorker.join(", ")}`);
  }
  console.log(
    `${name} Web Worker: ${Object.keys(worker.digests).length} samples match the approved digests`,
  );
  // WebP decoding, in the page and in the worker.
  const webpGolden = expectedWebp(webpExpected);
  for (const [where, digests] of [
    ["", webp],
    [" Web Worker", worker.webp],
  ]) {
    const differentWebp = compareDigests(digests, webpGolden);
    if (differentWebp.length > 0) {
      throw new Error(`${name}${where}: WebP pixels differ for ${differentWebp.join(", ")}`);
    }
    console.log(
      `${name}${where}: ${Object.keys(digests).length} WebP files decode to libwebp's pixels`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
