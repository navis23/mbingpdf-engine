import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { loadDocument, type PreviewServer, startPreview } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const engine = join(here, "../../mbingpdf");
// The tests run the engine from source, so they do not depend on a build.
const alias = {
  mbingpdf: join(engine, "src/index.ts"),
  "mbingpdf/svg": join(engine, "src/svg/index.ts"),
  "mbingpdf/jsx-runtime": join(engine, "src/jsx-runtime.ts"),
  fflate: createRequire(join(engine, "package.json")).resolve("fflate"),
};
const work = join(here, `.tmp-${process.pid}`);

beforeAll(() => {
  mkdirSync(work, { recursive: true });
  cpSync(join(here, "fixtures"), work, { recursive: true });
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

const head = (bytes: Uint8Array): string => new TextDecoder().decode(bytes.subarray(0, 5));

describe("loadDocument", () => {
  test("loads a TypeScript and JSX file with what it imports and reads", async () => {
    const { document, options, engine } = await loadDocument(join(work, "hello.tsx"), { alias });
    expect(document.type).toBe("Document");
    expect(options).toEqual({ deterministic: true });
    // The file reads note.txt relative to itself; that must survive being bundled elsewhere.
    expect(JSON.stringify(document)).toContain("A note read from disk.");
    expect(JSON.stringify(document)).toContain("Hello from the preview");
    expect(engine.previewPages(document)).toHaveLength(2);
    expect(head(await engine.render(document, options))).toBe("%PDF-");
  });

  test("explains what the file must export", async () => {
    const file = join(work, "empty.ts");
    writeFileSync(file, "export const nothing = 1;\n");
    await expect(loadDocument(file, { alias })).rejects.toThrow(
      /default export must be a Document/,
    );
    await expect(loadDocument(join(work, "missing.ts"))).rejects.toThrow(/No such file/);
  });
});

describe("startPreview", () => {
  let server: PreviewServer;
  let changes: ({ pages: number; ms: number } | { error: unknown })[] = [];
  let waiting: (() => void) | undefined;
  const file = join(work, "live.tsx");

  /** Resolves at the next load of the file. */
  const nextChange = (): Promise<void> =>
    new Promise((resolve) => {
      waiting = resolve;
    });

  const get = (path: string): Promise<Response> => fetch(new URL(path, server.url));

  beforeAll(async () => {
    cpSync(join(work, "hello.tsx"), file);
    const first = nextChange();
    server = await startPreview(file, {
      alias,
      port: 0,
      onChange: (result) => {
        changes.push(result);
        waiting?.();
      },
    });
    await first;
  });

  afterAll(async () => {
    await server.close();
  });

  test("serves the preview page, the pages and the PDF", async () => {
    expect(changes).toEqual([{ pages: 2, ms: expect.any(Number) }]);

    const html = await (await get("/")).text();
    expect(html).toContain("<title>live.tsx — mbingpdf</title>");
    expect(html).toContain('new EventSource("/events")');

    const state = await (await get("/state")).json();
    expect(state.error).toBeUndefined();
    expect(state.pages).toHaveLength(2);
    expect(state.pages[0].width).toBeCloseTo(297.64, 1);
    expect(state.pages[0].links).toEqual([
      expect.objectContaining({ url: "https://example.com", x: expect.any(Number) }),
    ]);

    const svg = await get("/page/1.svg");
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    const plain = await svg.text();
    expect(plain).toMatch(/^<svg /);
    // With outlines there is more to draw.
    expect((await (await get("/page/1.svg?debug=1")).text()).length).toBeGreaterThan(plain.length);
    expect((await get("/page/3.svg")).status).toBe(404);

    const pdf = await get("/document.pdf");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(head(new Uint8Array(await pdf.arrayBuffer()))).toBe("%PDF-");
    expect((await get("/nothing")).status).toBe(404);
  });

  test("loads the file again when it is saved, and tells the browser", async () => {
    const events = await get("/events");
    const reader = (events.body as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(": connected");

    const source = readFileSync(file, "utf8");
    let change = nextChange();
    writeFileSync(
      file,
      source.replace("<PageBreak />", "<PageBreak /><Text>More</Text><PageBreak />"),
    );
    await change;
    // A save can be reported twice by the file system; wait for the result of the last one.
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ pages: 3, ms: expect.any(Number) }));
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: change");
    const state = await (await get("/state")).json();
    expect(state.pages).toHaveLength(3);
    expect(state.version).toBeGreaterThan(1);

    // A file that no longer compiles is reported, and the preview recovers when it is fixed.
    change = nextChange();
    writeFileSync(file, `${source}\nconst broken = ;\n`);
    await change;
    // A save can be reported twice by the file system; wait for the result of the last one.
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ error: expect.anything() }));
    expect((await (await get("/state")).json()).error).toEqual(expect.any(String));

    change = nextChange();
    writeFileSync(file, source);
    await change;
    // A save can be reported twice by the file system; wait for the result of the last one.
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ pages: 2, ms: expect.any(Number) }));
    expect((await (await get("/state")).json()).error).toBeUndefined();
    await reader.cancel();
    changes = [];
  });
});

// The command runs the built packages, as a user's installation would.
const cli = join(here, "../dist/cli.mjs");
const built = existsSync(cli) && existsSync(join(engine, "dist/index.js"));

describe.skipIf(!built)("the mbingpdf command", () => {
  test("build writes the PDF", () => {
    const out = join(work, "out.pdf");
    const run = spawnSync(process.execPath, [cli, "build", join(work, "hello.tsx"), "-o", out], {
      encoding: "utf8",
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/out\.pdf {2}[\d.]+ kB {2}\d+ ms/);
    expect(head(readFileSync(out))).toBe("%PDF-");
  });

  test("explains itself and refuses what it does not know", () => {
    const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    expect(help.stdout).toContain("mbingpdf dev <file>");
    const unknown = spawnSync(process.execPath, [cli, "print", "x.ts"], { encoding: "utf8" });
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown command "print"');
    const missing = spawnSync(process.execPath, [cli, "build", "nowhere.ts"], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("No such file");
  });
});
