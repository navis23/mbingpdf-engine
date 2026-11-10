/**
 * The preview server: watches a document file and shows its pages in the browser, laid out
 * again each time the file is saved.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename } from "node:path";
import type { LayoutWarning } from "mbingpdf";
import type { PreviewPage } from "mbingpdf/svg";
import { type LoadedDocument, type LoadOptions, watchDocument } from "./load.ts";
import { previewHtml } from "./page.ts";

export interface PreviewOptions extends LoadOptions {
  /** The port to listen on. Default 4173; 0 picks a free one. */
  port?: number;
  /** The address to listen on. Default `127.0.0.1`: this computer only. */
  host?: string;
  /** Called after each load of the file, successful or not. */
  onChange?: (result: { pages: number; ms: number } | { error: unknown }) => void;
}

export interface PreviewServer {
  /** Where the preview is, such as `http://127.0.0.1:4173/`. */
  readonly url: string;
  close(): Promise<void>;
}

interface Laid {
  pages: PreviewPage[];
  warnings: readonly LayoutWarning[];
  ms: number;
}

const describe = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** Starts the preview of a document file. Resolves once the server is listening. */
export async function startPreview(
  file: string,
  options: PreviewOptions = {},
): Promise<PreviewServer> {
  let version = 0;
  let loaded: LoadedDocument | undefined;
  let failure: string | undefined;
  // Layouts of the current version of the file: with and without outlines.
  const layouts = new Map<boolean, Laid>();
  const listeners = new Set<ServerResponse>();

  const layout = (debug: boolean): Laid | undefined => {
    if (!loaded) return undefined;
    let laid = layouts.get(debug);
    if (!laid) {
      const start = performance.now();
      const result = loaded.engine.layoutDocument(loaded.document, { debug });
      laid = {
        pages: loaded.engine.previewPages(result),
        warnings: result.warnings,
        ms: Math.round(performance.now() - start),
      };
      layouts.set(debug, laid);
    }
    return laid;
  };

  const watcher = watchDocument(
    file,
    (result) => {
      version++;
      if ("error" in result) {
        failure = describe(result.error);
        options.onChange?.({ error: result.error });
      } else {
        loaded = result;
        layouts.clear();
        failure = undefined;
        try {
          const laid = layout(false) as Laid;
          options.onChange?.({ pages: laid.pages.length, ms: laid.ms });
        } catch (error) {
          // The file loaded but cannot be laid out; the last good pages are gone with it.
          loaded = undefined;
          failure = describe(error);
          options.onChange?.({ error });
        }
      }
      for (const listener of listeners) listener.write("event: change\ndata: {}\n\n");
    },
    options,
  );

  const send = (
    response: ServerResponse,
    status: number,
    type: string,
    body: string | Uint8Array,
  ) => {
    response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    response.end(body);
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const debug = url.searchParams.has("debug");
    try {
      if (url.pathname === "/") {
        return send(response, 200, "text/html; charset=utf-8", previewHtml(basename(file)));
      }
      if (url.pathname === "/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        response.write(": connected\n\n");
        listeners.add(response);
        request.on("close", () => listeners.delete(response));
        return;
      }
      if (url.pathname === "/state") {
        const laid = failure === undefined ? layout(debug) : undefined;
        return send(
          response,
          200,
          "application/json",
          JSON.stringify({
            version,
            error: failure ?? (loaded ? undefined : "Loading the document…"),
            ms: laid?.ms ?? 0,
            warnings: laid?.warnings ?? [],
            pages: (laid?.pages ?? []).map((page) => ({
              width: page.width,
              height: page.height,
              links: page.links,
              anchors: page.anchors,
            })),
          }),
        );
      }
      const pageMatch = /^\/page\/(\d+)\.svg$/.exec(url.pathname);
      if (pageMatch) {
        const page = layout(debug)?.pages[Number(pageMatch[1]) - 1];
        if (!page) return send(response, 404, "text/plain", "No such page");
        return send(response, 200, "image/svg+xml", page.svg());
      }
      if (url.pathname === "/document.pdf") {
        if (!loaded) return send(response, 503, "text/plain", failure ?? "Not loaded yet");
        const { engine, document, options: renderOptions } = loaded;
        engine.render(document, { ...renderOptions, debug }).then(
          (bytes) => send(response, 200, "application/pdf", bytes),
          (error: unknown) => send(response, 500, "text/plain; charset=utf-8", describe(error)),
        );
        return;
      }
      send(response, 404, "text/plain", "Not found");
    } catch (error) {
      send(response, 500, "text/plain; charset=utf-8", describe(error));
    }
  });

  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4173, host, resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${host.includes(":") ? `[${host}]` : host}:${port}/`,
    async close() {
      for (const listener of listeners) listener.end();
      await watcher.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
