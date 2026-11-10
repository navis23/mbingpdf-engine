/** Entry point of the Web Worker used by the browser check: runs the samples off the main thread. */
import { runSamples } from "./browser-run.ts";

const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
  document?: unknown;
};

runSamples().then(
  // Report whether a DOM was available: in a worker it must not be.
  (digests) => scope.postMessage({ digests, hasDocument: typeof scope.document !== "undefined" }),
  (error: unknown) => scope.postMessage({ error: String(error) }),
);
