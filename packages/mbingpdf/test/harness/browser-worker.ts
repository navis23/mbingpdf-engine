/** Entry point of the Web Worker used by the browser check: runs the samples off the main thread. */
import { runSamples, runWebp } from "./browser-run.ts";

const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
  document?: unknown;
};

// The worker is told which WebP files to decode in its name.
const webpNames = (globalThis as unknown as { name: string }).name.split(",").filter(Boolean);

Promise.all([runSamples(), runWebp(webpNames)]).then(
  // Report whether a DOM was available: in a worker it must not be.
  ([digests, webp]) =>
    scope.postMessage({ digests, webp, hasDocument: typeof scope.document !== "undefined" }),
  (error: unknown) => scope.postMessage({ error: String(error) }),
);
