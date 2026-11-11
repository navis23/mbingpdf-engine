/**
 * Makes everything the site is built from that is not written by hand:
 *
 * - the showcase documents, laid out by mbingpdf itself, as SVG pictures and PDF files;
 * - the documentation pages, from the Markdown in the repository;
 * - the HTML of every page.
 *
 * Vite then bundles the scripts and styles the pages refer to. Run with `node build/generate.ts`.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, type Tokens } from "marked";
import { createHighlighter } from "shiki";
import * as mbingpdf from "../../packages/mbingpdf/src/index.ts";
import { renderSvg } from "../../packages/mbingpdf/src/svg/index.ts";
import { encodePng, renderPdf } from "../../packages/mbingpdf/test/harness/render.ts";
import { docsPage, homePage, notFoundPage, playgroundPage } from "./pages.ts";
import { codeTheme } from "./theme.ts";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "..");
const REPO_URL = "https://github.com/navis23/mbingpdf-engine";

const version: string = JSON.parse(
  readFileSync(join(repo, "packages/mbingpdf/package.json"), "utf8"),
).version;

function write(path: string, content: string | Uint8Array): void {
  const file = join(site, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// ----- fonts the documents are set in -----

const FONT_FILES = {
  jakarta: "PlusJakartaSans-Variable.ttf",
  barlow: "BarlowCondensed-Bold.ttf",
  mono: "JetBrainsMono-Variable.ttf",
} as const;

const fontDir = join(repo, "packages/mbingpdf/test/fonts");
mkdirSync(join(site, "public/fonts"), { recursive: true });
const fonts: Record<string, mbingpdf.Font> = {};
for (const [name, file] of Object.entries(FONT_FILES)) {
  // The playground loads the same files in the browser.
  cpSync(join(fontDir, file), join(site, "public/fonts", file));
  fonts[name] = new mbingpdf.Font(new Uint8Array(readFileSync(join(fontDir, file))));
}
for (const licence of readdirSync(fontDir).filter((file) => file.endsWith("-OFL.txt"))) {
  cpSync(join(fontDir, licence), join(site, "public/fonts", licence));
}

// ----- the showcase documents -----

export interface Showcase {
  readonly id: string;
  readonly title: string;
  /** One line under the picture. */
  readonly caption: string;
  /** Paper size, as a print shop would write it. */
  readonly paper: string;
  readonly pages: number;
  /** Width over height of the first page, for laying pictures out before they load. */
  readonly ratio: number;
  readonly milliseconds: number;
  readonly bytes: number;
}

const SHOWCASE: readonly { id: string; title: string; caption: string; paper: string }[] = [
  {
    id: "certificate",
    title: "Certificate",
    caption: "Bleed, crop marks and a name sized to fit",
    paper: "A4 landscape + 3 mm bleed",
  },
  {
    id: "invoice",
    title: "Invoice",
    caption: "A table, totals, a QR code and a footer",
    paper: "A4",
  },
  {
    id: "report",
    title: "Report",
    caption: "Hyphenated columns, charts and a table",
    paper: "A4",
  },
  { id: "bib", title: "Race bib", caption: "A number that fills the width", paper: "A5 landscape" },
  {
    id: "labels",
    title: "Label sheet",
    caption: "Forty labels, barcodes, cut lines",
    paper: "A4, 3 × 8 labels",
  },
  {
    id: "ticket",
    title: "Ticket",
    caption: "Its own paper size and a tear line",
    paper: "90 × 190 mm",
  },
];

/** Runs a template (the body of a function, as the playground runs it) and returns its document. */
function runTemplate(code: string): mbingpdf.LayoutNode {
  const names = Object.keys(mbingpdf);
  const values = names.map((name) => (mbingpdf as Record<string, unknown>)[name]);
  // Inside a block, so that a template may name a variable of its own after an export.
  const make = new Function(...names, "fonts", `{\n${code}\n}`);
  return make(...values, fonts) as mbingpdf.LayoutNode;
}

rmSync(join(site, "public/gallery"), { recursive: true, force: true });
const showcase: Showcase[] = [];
for (const entry of SHOWCASE) {
  const code = readFileSync(join(site, "templates", `${entry.id}.js`), "utf8");
  const document = runTemplate(code);
  // Timed on a second run: the first also pays for the engine warming up.
  mbingpdf.render.sync(runTemplate(code), { strict: true });
  const started = performance.now();
  const pdf = mbingpdf.render.sync(document, { strict: true });
  const milliseconds = performance.now() - started;
  const pages = renderSvg(document);
  const first = pages[0] as string;
  const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(first);
  write(`public/gallery/${entry.id}.svg`, first);
  write(`public/gallery/${entry.id}.pdf`, pdf);
  showcase.push({
    ...entry,
    pages: pages.length,
    ratio: size ? Number(size[1]) / Number(size[2]) : 1,
    milliseconds,
    bytes: pdf.length,
  });
}

// The picture at the top of the home page is the certificate's PDF itself, drawn by PDFium: the
// on-screen preview shows the finished page, and here the press sheet is the point, with its
// bleed and its crop and registration marks.
const [pressSheet] = await renderPdf(
  "pdfium",
  readFileSync(join(site, "public/gallery/certificate.pdf")),
  2.4,
);
if (!pressSheet) throw new Error("The certificate did not render");
write("public/gallery/certificate-sheet.png", encodePng(pressSheet));
const pressRatio = pressSheet.width / pressSheet.height;

// The picture for links shared elsewhere: a page of the size those pictures have.
const [card] = await renderPdf(
  "pdfium",
  mbingpdf.render.sync(runTemplate(readFileSync(join(site, "templates/og.js"), "utf8"))),
  1,
);
if (!card) throw new Error("The share picture did not render");
write("public/og.png", encodePng(card));

// The small example on the home page: the code shown is the code that made the picture.
const snippet = readFileSync(join(site, "templates/hello.js"), "utf8");
write("public/gallery/hello.svg", renderSvg(runTemplate(snippet))[0] as string);

// ----- documentation -----

interface DocSource {
  readonly slug: string;
  readonly title: string;
  readonly group: string;
  /** Path of the Markdown file in the repository. */
  readonly source: string;
  readonly description: string;
}

const DOCS: readonly DocSource[] = [
  {
    slug: "quick-start",
    title: "Quick start",
    group: "Guide",
    source: "docs/guide/quick-start.md",
    description: "From a first document to themes, tables, charts and print.",
  },
  {
    slug: "elements",
    title: "Element reference",
    group: "Guide",
    source: "docs/guide/elements.md",
    description: "Every element and every property.",
  },
  {
    slug: "adopting",
    title: "Moving from printed HTML",
    group: "Guide",
    source: "docs/guide/adopting.md",
    description: "Take one document from window.print() to a real PDF.",
  },
  {
    slug: "react",
    title: "React",
    group: "Packages",
    source: "packages/react/README.md",
    description: "PdfPreview and usePdf for React.",
  },
  {
    slug: "vue",
    title: "Vue and Nuxt",
    group: "Packages",
    source: "packages/vue/README.md",
    description: "PdfPreview and usePdf for Vue and Nuxt.",
  },
  {
    slug: "dev",
    title: "Preview server",
    group: "Packages",
    source: "packages/dev/README.md",
    description: "See a document redraw as you save.",
  },
  {
    slug: "benchmarks",
    title: "Benchmarks",
    group: "More",
    source: "docs/benchmarks.md",
    description: "Speed and file size next to three other libraries.",
  },
];

const highlighter = await createHighlighter({
  themes: [codeTheme],
  langs: ["ts", "tsx", "js", "sh", "vue", "json", "text"],
});

export function highlight(code: string, lang: string): string {
  const known = highlighter.getLoadedLanguages();
  return highlighter.codeToHtml(code.replace(/\n$/, ""), {
    lang: known.includes(lang) ? lang : "text",
    theme: codeTheme.name,
  });
}

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export interface Heading {
  readonly id: string;
  readonly text: string;
  readonly depth: number;
}

function renderDoc(doc: DocSource): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const used = new Set<string>();
  const sourceDir = dirname(join(repo, doc.source));
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(
        this: { parser: { parseInline(tokens: Tokens.Generic[]): string } },
        token: Tokens.Heading,
      ) {
        const html = this.parser.parseInline(token.tokens);
        // The page shows its title itself.
        if (token.depth === 1) return "";
        let id = slugify(token.text);
        while (used.has(id)) id += "-";
        used.add(id);
        if (token.depth <= 3) headings.push({ id, text: html, depth: token.depth });
        return `<h${token.depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${html}</h${token.depth}>\n`;
      },
      code(token: Tokens.Code) {
        return `<div class="code">${highlight(token.text, token.lang ?? "text")}</div>\n`;
      },
      table(
        this: { parser: { parseInline(tokens: Tokens.Generic[]): string } },
        token: Tokens.Table,
      ) {
        const cell = (item: Tokens.TableCell, tag: string): string => {
          const align = item.align ? ` style="text-align:${item.align}"` : "";
          return `<${tag}${align}>${this.parser.parseInline(item.tokens)}</${tag}>`;
        };
        const head = token.header.map((item) => cell(item, "th")).join("");
        const body = token.rows
          .map((row) => `<tr>${row.map((item) => cell(item, "td")).join("")}</tr>`)
          .join("\n");
        // Wide tables scroll inside their own box on a phone, not the page.
        return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
      },
      link(
        this: { parser: { parseInline(tokens: Tokens.Generic[]): string } },
        token: Tokens.Link,
      ) {
        const text = this.parser.parseInline(token.tokens);
        let href = token.href;
        let external = /^[a-z]+:/i.test(href);
        if (!external && !href.startsWith("#")) {
          // A link to another file of the repository: a page of the site if it is one,
          // otherwise the file on GitHub.
          const [path = "", hash] = href.split("#");
          const target = relative(repo, resolve(sourceDir, path));
          const page = DOCS.find((other) => other.source === target);
          if (page) href = `/docs/${page.slug}/${hash ? `#${hash}` : ""}`;
          else {
            const kind = /\.[a-z0-9]+$/i.test(target) ? "blob" : "tree";
            href = `${REPO_URL}/${kind}/main/${target}`;
            external = true;
          }
        } else if (href.startsWith(`${REPO_URL}/tree/main/packages/`)) {
          // The packages have pages of their own here.
          const page = DOCS.find((other) => href.endsWith(dirname(other.source)));
          if (page) {
            href = `/docs/${page.slug}/`;
            external = false;
          }
        }
        const attributes = external ? ' target="_blank" rel="noopener"' : "";
        return `<a href="${href}"${attributes}>${text}</a>`;
      },
    },
  });
  const markdown = readFileSync(join(repo, doc.source), "utf8");
  return { html: marked.parse(markdown) as string, headings };
}

// ----- pages -----

const navigation = DOCS.map((doc) => ({ slug: doc.slug, title: doc.title, group: doc.group }));
for (const doc of DOCS) {
  const { html, headings } = renderDoc(doc);
  write(
    `docs/${doc.slug}/index.html`,
    docsPage({
      version,
      slug: doc.slug,
      title: doc.title,
      description: doc.description,
      html,
      headings,
      navigation,
      source: `${REPO_URL}/blob/main/${doc.source}`,
    }),
  );
}
// /docs/ itself goes to the first page. A plain file, copied as it is: not a page to bundle.
write(
  "public/docs/index.html",
  '<!doctype html><meta charset="utf-8"><title>mbingpdf documentation</title>' +
    '<meta http-equiv="refresh" content="0; url=/docs/quick-start/"><link rel="canonical" href="/docs/quick-start/">',
);

write("index.html", homePage({ version, showcase, snippet: highlight(snippet, "js"), pressRatio }));
write("playground/index.html", playgroundPage({ version, showcase }));
write("404.html", notFoundPage({ version }));

console.log(
  `Generated ${showcase.length} documents (${showcase
    .map((item) => `${item.id} ${Math.round(item.milliseconds)} ms`)
    .join(", ")}) and ${DOCS.length} documentation pages for mbingpdf ${version}.`,
);
