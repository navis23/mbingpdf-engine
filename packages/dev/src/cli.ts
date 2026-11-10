#!/usr/bin/env node
/** The `mbingpdf` command. */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { loadDocument } from "./load.ts";
import { startPreview } from "./server.ts";

const HELP = `mbingpdf — preview and build PDF documents

Usage:
  mbingpdf dev <file>              Show the document in the browser; redraw on every save
  mbingpdf build <file>            Write the document as a PDF

The file's default export is a Document, or a function (it may be async) that returns one.
It may also export "options", passed to render(). TypeScript and JSX work as they are.

Options for dev:
  -p, --port <number>   Port to listen on (default 4173)
      --host <address>  Address to listen on (default 127.0.0.1)
      --open            Open the browser

Options for build:
  -o, --out <file>      Where to write (default: the file's name with .pdf)
      --debug           Outline every element's box
      --strict          Treat warnings as errors
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function open(url: string): void {
  const [command, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  spawn(command as string, args, { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      open: { type: "boolean" },
      out: { type: "string", short: "o" },
      debug: { type: "boolean" },
      strict: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, file] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return;
  }
  if (command !== "dev" && command !== "build") fail(`Unknown command "${command}".\n\n${HELP}`);
  if (!file) fail(`mbingpdf ${command} needs a file.\n\n${HELP}`);

  if (command === "build") {
    const start = performance.now();
    const { engine, document, options } = await loadDocument(file);
    const out = values.out ?? `${basename(file, extname(file))}.pdf`;
    const warnings: string[] = [];
    const bytes = await engine.render(document, {
      ...options,
      ...(values.debug ? { debug: true } : {}),
      ...(values.strict ? { strict: true } : {}),
      onWarning: (warning) => {
        warnings.push(`  warning: ${warning.message}${warning.path ? ` (${warning.path})` : ""}`);
        options.onWarning?.(warning);
      },
    });
    writeFileSync(out, bytes);
    for (const warning of warnings) process.stderr.write(`${warning}\n`);
    const kb = (bytes.length / 1024).toFixed(1);
    process.stdout.write(`${out}  ${kb} kB  ${Math.round(performance.now() - start)} ms\n`);
    return;
  }

  const port = values.port === undefined ? 4173 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Not a port: ${values.port}`);
  const time = (): string => new Date().toLocaleTimeString();
  const server = await startPreview(file, {
    port,
    ...(values.host ? { host: values.host } : {}),
    onChange: (result) => {
      if ("error" in result) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        process.stderr.write(`${time()}  error: ${message}\n`);
      } else {
        const pages = `${result.pages} ${result.pages === 1 ? "page" : "pages"}`;
        process.stdout.write(`${time()}  ${pages}, ${result.ms} ms\n`);
      }
    },
  });
  process.stdout.write(`Preview of ${file} at ${server.url}\n`);
  if (values.open) open(server.url);
  const stop = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
