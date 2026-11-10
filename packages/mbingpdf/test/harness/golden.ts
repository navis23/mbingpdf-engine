/** Reading, writing and comparing approved ("golden") files. Node only. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { decodePng, encodePng, type RenderedPage } from "./render.ts";

/** Set UPDATE_GOLDEN=1 to approve the current output instead of checking it. */
export const UPDATE_GOLDEN: boolean = process.env.UPDATE_GOLDEN === "1";

const testDir = fileURLToPath(new URL("..", import.meta.url));
export const goldenDir: string = join(testDir, "golden");
/** Actual and diff images of failed comparisons land here; the folder is not committed. */
export const artifactDir: string = join(testDir, ".artifacts");

function write(path: string, data: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export function readGoldenJson<T>(name: string): T | undefined {
  const path = join(goldenDir, name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
}

export function writeGoldenJson(name: string, value: unknown): void {
  write(join(goldenDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

export interface ImageComparison {
  /** `"missing"` when there is no approved image yet. */
  status: "match" | "different" | "missing" | "updated";
  /** Share of pixels that differ, 0–1. */
  difference: number;
  detail: string;
}

/**
 * Pixels may differ by this share before a comparison fails. Renderers are deterministic on one
 * machine; the allowance covers anti-aliasing differences between CPU architectures.
 */
export const MAX_DIFFERENCE = 0.001;

export function compareWithGolden(name: string, actual: RenderedPage): ImageComparison {
  const path = join(goldenDir, `${name}.png`);
  if (UPDATE_GOLDEN) {
    write(path, encodePng(actual));
    return { status: "updated", difference: 0, detail: `approved ${name}.png` };
  }
  if (!existsSync(path)) {
    write(join(artifactDir, `${name}.actual.png`), encodePng(actual));
    return {
      status: "missing",
      difference: 1,
      detail: `No approved image ${name}.png. Review test/.artifacts/${name}.actual.png, then run with UPDATE_GOLDEN=1.`,
    };
  }
  const expected = decodePng(readFileSync(path));
  if (expected.width !== actual.width || expected.height !== actual.height) {
    write(join(artifactDir, `${name}.actual.png`), encodePng(actual));
    return {
      status: "different",
      difference: 1,
      detail: `${name}: size is ${actual.width}×${actual.height}, approved image is ${expected.width}×${expected.height}`,
    };
  }
  const diff = new Uint8Array(actual.pixels.length);
  const count = pixelmatch(expected.pixels, actual.pixels, diff, actual.width, actual.height, {
    threshold: 0.1,
  });
  const difference = count / (actual.width * actual.height);
  if (difference <= MAX_DIFFERENCE) return { status: "match", difference, detail: "" };
  write(join(artifactDir, `${name}.actual.png`), encodePng(actual));
  write(
    join(artifactDir, `${name}.diff.png`),
    encodePng({ width: actual.width, height: actual.height, pixels: diff }),
  );
  return {
    status: "different",
    difference,
    detail: `${name}: ${count} pixels differ (${(difference * 100).toFixed(3)}%). See test/.artifacts/${name}.diff.png.`,
  };
}
