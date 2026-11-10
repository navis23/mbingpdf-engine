/**
 * Turns a document file (TypeScript, JSX or plain JavaScript) into something that can be run:
 * the file and what it imports from disk are bundled into one module, which is then imported.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DocumentLayout, LayoutNode, RenderOptions } from "mbingpdf";
import type { PreviewPage } from "mbingpdf/svg";
import { type InputOptions, type OutputOptions, type Plugin, rolldown, watch } from "rolldown";

/** The parts of mbingpdf the tools use, taken from the same copy the document file uses. */
export interface Engine {
  render(document: LayoutNode, options?: RenderOptions): Promise<Uint8Array>;
  layoutDocument(document: LayoutNode, options?: { debug?: boolean }): DocumentLayout;
  previewPages(document: LayoutNode | DocumentLayout): PreviewPage[];
}

/** A document file, loaded. */
export interface LoadedDocument {
  /** The document the file gives. */
  document: LayoutNode;
  /** The file's `options` export, if it has one. */
  options: RenderOptions;
  engine: Engine;
}

export interface LoadOptions {
  /** Replace imports by name with a file, such as `{ mbingpdf: "/path/to/src/index.ts" }`. */
  alias?: Record<string, string>;
}

const ENTRY = "\0mbingpdf-dev-entry";

function inputOptions(file: string, options: LoadOptions): InputOptions {
  const alias = options.alias ?? {};
  const entry: Plugin = {
    name: "mbingpdf-dev",
    resolveId(id) {
      return id === ENTRY ? ENTRY : undefined;
    },
    load(id) {
      if (id !== ENTRY) return undefined;
      // The engine is imported here, next to the document, so both use one copy of it: the
      // one installed in the document's project.
      return [
        `import * as user from ${JSON.stringify(file)};`,
        `import { render, layoutDocument } from "mbingpdf";`,
        `import { previewPages } from "mbingpdf/svg";`,
        "export const engine = { render, layoutDocument, previewPages };",
        "export { user };",
      ].join("\n");
    },
    transform(code, id) {
      // Bundling moves the code to another file; these must keep pointing at the original, so
      // that fonts and images read relative to a source file are still found.
      if (id === ENTRY || !code.includes("import.meta.")) return undefined;
      return code
        .replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(id).href))
        .replace(/\bimport\.meta\.filename\b/g, JSON.stringify(id))
        .replace(/\bimport\.meta\.dirname\b/g, JSON.stringify(dirname(id)));
    },
  };
  return {
    input: ENTRY,
    plugins: [entry],
    platform: "node",
    resolve: { alias },
    // Packages stay as imports, to be found in the document's project when the bundle runs.
    external: (id) =>
      id !== ENTRY && !id.startsWith(".") && !isAbsolute(id) && !Object.hasOwn(alias, id),
    transform: { jsx: { runtime: "automatic", importSource: "mbingpdf" } },
    logLevel: "silent",
  };
}

/**
 * Where the bundle is written: inside the nearest `node_modules`, so the packages it imports
 * are found from there. Without one, next to the file.
 */
function outputDirectory(file: string): string {
  let directory = dirname(file);
  for (;;) {
    if (existsSync(join(directory, "node_modules"))) {
      return join(directory, "node_modules", ".mbingpdf-dev");
    }
    const parent = dirname(directory);
    if (parent === directory) return join(dirname(file), ".mbingpdf-dev");
    directory = parent;
  }
}

let counter = 0;

function outputOptions(file: string): OutputOptions & { file: string } {
  const directory = outputDirectory(file);
  mkdirSync(directory, { recursive: true });
  return {
    file: join(directory, `document-${process.pid}-${++counter}.mjs`),
    format: "esm",
    codeSplitting: false,
  };
}

async function run(bundle: string): Promise<LoadedDocument> {
  // A new address each time, or Node would hand back the module it loaded before.
  const module = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}-${++counter}`);
  const user = module.user as { default?: unknown; options?: RenderOptions };
  let document = user.default;
  if (typeof document === "function") document = await document();
  if (
    typeof document !== "object" ||
    document === null ||
    (document as LayoutNode).type !== "Document"
  ) {
    throw new Error(
      "The file's default export must be a Document, or a function that returns one. " +
        "For example: export default Document(Page(Text('Hello')));",
    );
  }
  return {
    document: document as LayoutNode,
    options: user.options ?? {},
    engine: module.engine as Engine,
  };
}

/** Loads a document file once. */
export async function loadDocument(
  path: string,
  options: LoadOptions = {},
): Promise<LoadedDocument> {
  const file = resolve(path);
  if (!existsSync(file)) throw new Error(`No such file: ${path}`);
  const output = outputOptions(file);
  const build = await rolldown(inputOptions(file, options));
  try {
    await build.write(output);
    return await run(output.file);
  } finally {
    await build.close();
    rmSync(output.file, { force: true });
  }
}

export interface DocumentWatcher {
  close(): Promise<void>;
}

/**
 * Loads a document file now and again each time it, or a file it imports, is saved. `onChange`
 * gets the loaded document, or the error that stopped it from loading.
 */
export function watchDocument(
  path: string,
  onChange: (result: LoadedDocument | { error: unknown }) => void,
  options: LoadOptions = {},
): DocumentWatcher {
  const file = resolve(path);
  if (!existsSync(file)) throw new Error(`No such file: ${path}`);
  const output = outputOptions(file);
  const watcher = watch({ ...inputOptions(file, options), output });
  let latest = 0;
  watcher.on("event", (event) => {
    if (event.code === "BUNDLE_END") {
      const mine = ++latest;
      void event.result.close();
      run(output.file).then(
        (loaded) => mine === latest && onChange(loaded),
        (error: unknown) => mine === latest && onChange({ error }),
      );
    } else if (event.code === "ERROR") {
      ++latest;
      void event.result?.close();
      onChange({ error: event.error });
    }
  });
  return {
    async close() {
      await watcher.close();
      rmSync(output.file, { force: true });
    },
  };
}
