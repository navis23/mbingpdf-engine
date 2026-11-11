import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Every page the generator wrote: index.html, playground/, docs/…, 404.html. */
function pages(): Record<string, string> {
  const found: Record<string, string> = { home: here("./index.html"), missing: here("./404.html") };
  const visit = (dir: string): void => {
    for (const entry of readdirSync(here(`./${dir}`), { withFileTypes: true })) {
      if (entry.isDirectory()) visit(`${dir}/${entry.name}`);
      else if (entry.name === "index.html")
        found[dir.replace(/\//g, "-")] = here(`./${dir}/index.html`);
    }
  };
  visit("docs");
  visit("playground");
  return found;
}

export default defineConfig({
  resolve: {
    // The site is built from the library's source, so it never lags behind it.
    alias: [
      { find: /^mbingpdf$/, replacement: here("../packages/mbingpdf/src/index.ts") },
      { find: /^mbingpdf\/svg$/, replacement: here("../packages/mbingpdf/src/svg/index.ts") },
    ],
  },
  build: {
    target: "es2023",
    // The playground carries the whole engine and an editor.
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: pages() },
  },
});
