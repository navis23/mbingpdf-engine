/**
 * Runs veraPDF, the reference validator for PDF/A and PDF/UA, over files made by the tests.
 *
 * It is used from a `verapdf` command when one is installed, otherwise through the
 * `verapdf/cli` Docker image. Where neither exists the checks are skipped, unless the
 * environment says `VERAPDF=required` (as CI does), in which case they fail.
 */
import { execFile, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** veraPDF's names for the standards: PDF/A-2b, PDF/A-2u, PDF/A-3b, PDF/A-3u, PDF/UA-1. */
export type Flavour = "2b" | "2u" | "3b" | "3u" | "ua1";

const IMAGE = "verapdf/cli";

function findRunner(): "local" | "docker" | undefined {
  if (spawnSync("verapdf", ["--version"]).status === 0) return "local";
  if (spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }).status === 0) {
    return "docker";
  }
  if (process.env.VERAPDF === "required") {
    // Not downloaded yet: fetch it once.
    if (spawnSync("docker", ["pull", IMAGE], { stdio: "ignore" }).status === 0) return "docker";
    throw new Error("VERAPDF=required, but neither a verapdf command nor Docker can run it");
  }
  return undefined;
}

/** How veraPDF can be run here, or undefined when it cannot. */
export const veraPdf: "local" | "docker" | undefined = findRunner();

/**
 * Validates files against one standard, or with `"auto"` each against the PDF/A level it
 * declares itself to be. Returns, for each file, the standard it was held to and the rules it
 * breaks: `"2u: ok"` for a file that conforms, `"2u: 6.2.4.3-2 6.6.4-1"` for one that does not.
 */
export async function validate(
  files: Readonly<Record<string, Uint8Array>>,
  flavour: Flavour | "auto",
): Promise<Record<string, string>> {
  if (!veraPdf) throw new Error("veraPDF is not available");
  const dir = mkdtempSync(join(tmpdir(), "mbingpdf-verapdf-"));
  try {
    // The container runs as another user and must be able to read the files.
    chmodSync(dir, 0o755);
    for (const [name, bytes] of Object.entries(files))
      writeFileSync(join(dir, `${name}.pdf`), bytes);
    const options = ["-f", flavour === "auto" ? "0" : flavour, "--format", "text", "-v"];
    const [command, args] =
      veraPdf === "local"
        ? ["verapdf", [...options, dir]]
        : ["docker", ["run", "--rm", "-v", `${dir}:/data:ro`, IMAGE, ...options, "/data"]];
    // veraPDF exits with 1 when a file fails, which is an answer, not an error.
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
      execFile(
        command,
        args,
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        (_e, stdout, stderr) => resolve({ stdout, stderr }),
      );
    });
    const rules: Record<string, { flavour: string; broken: string[] }> = {};
    let current: string[] | undefined;
    for (const line of result.stdout.split("\n")) {
      const file = /^(?:PASS|FAIL) .*?([^/\\]+)\.pdf (\S+)/.exec(line);
      if (file) {
        current = [];
        rules[file[1] as string] = { flavour: file[2] as string, broken: current };
        continue;
      }
      const rule = /^\s+FAIL (\S+)/.exec(line);
      if (rule && current) current.push(rule[1] as string);
    }
    const verdicts: Record<string, string> = {};
    for (const name of Object.keys(files)) {
      const verdict = rules[name];
      if (!verdict) {
        throw new Error(`veraPDF gave no verdict on ${name}:\n${result.stdout}\n${result.stderr}`);
      }
      verdicts[name] = `${verdict.flavour}: ${verdict.broken.sort().join(" ") || "ok"}`;
    }
    return verdicts;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
