/** The HTML of every page. Plain functions from data to text: no framework. */
import type { Heading, Showcase } from "./generate.ts";

const REPO_URL = "https://github.com/navis23/mbingpdf-engine";
const NPM_URL = "https://www.npmjs.com/package/mbingpdf";
const SITE_URL = "https://mbingpdf.enterbiner.com";

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The mark: a sheet with a turned corner, between four crop marks. */
const MARK =
  '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">' +
  '<path class="mark-sheet" d="M9 9h10l4 4v10H9z"/>' +
  '<path class="mark-fold" d="M19 9v4h4z"/>' +
  '<path class="mark-crop" d="M2 9h4M9 2v4M26 9h4M23 2v4M2 23h4M9 26v4M26 23h4M23 26v4"/></svg>';

const WORDMARK = `${MARK}<span class="wordmark">mbing<b>pdf</b></span>`;

const ARROW =
  '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const COPY =
  '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10H4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

/** A registration target, as printed in the margin of a press sheet. */
const TARGET =
  '<svg class="target" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor"/><path d="M12 1v22M1 12h22" stroke="currentColor" fill="none"/></svg>';

/** The printer's colour bar: the four process inks and their tints. */
const COLORBAR = `<div class="colorbar" aria-hidden="true">${[
  "c",
  "m",
  "y",
  "k",
  "c50",
  "m50",
  "y50",
  "k50",
  "r",
  "g",
  "b",
  "k25",
]
  .map((ink) => `<i class="ink-${ink}"></i>`)
  .join("")}</div>`;

interface ShellOptions {
  title: string;
  description: string;
  path: string;
  version: string;
  body: string;
  /** Which item of the navigation is the current page. */
  current?: "docs" | "playground" | "benchmarks";
  bodyClass?: string;
  scripts?: readonly string[];
}

function header(version: string, current: ShellOptions["current"]): string {
  const item = (href: string, label: string, key?: string): string =>
    `<a href="${href}"${key && key === current ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<header class="top">
  <a class="brand" href="/" aria-label="mbingpdf home">${WORDMARK}</a>
  <span class="version">v${escapeHtml(version)}</span>
  <nav class="nav" aria-label="Main">
    ${item("/docs/quick-start/", "Docs", "docs")}
    ${item("/playground/", "Playground", "playground")}
    ${item("/docs/benchmarks/", "Benchmarks", "benchmarks")}
    <a href="${REPO_URL}" rel="noopener">GitHub</a>
    <a href="${NPM_URL}" rel="noopener">npm</a>
  </nav>
</header>`;
}

function footer(version: string): string {
  return `<footer class="foot">
  <div class="foot-marks" aria-hidden="true">${TARGET}${COLORBAR}${TARGET}</div>
  <div class="foot-grid">
    <div>
      <a class="brand" href="/" aria-label="mbingpdf home">${WORDMARK}</a>
      <p>A PDF engine in TypeScript.<br>Open source under the MIT licence.</p>
    </div>
    <nav aria-label="Documentation">
      <h2>Learn</h2>
      <a href="/docs/quick-start/">Quick start</a>
      <a href="/docs/elements/">Element reference</a>
      <a href="/docs/adopting/">Moving from printed HTML</a>
      <a href="/playground/">Playground</a>
    </nav>
    <nav aria-label="Packages">
      <h2>Packages</h2>
      <a href="${NPM_URL}" rel="noopener">mbingpdf</a>
      <a href="/docs/react/">@mbingpdf/react</a>
      <a href="/docs/vue/">@mbingpdf/vue</a>
      <a href="/docs/dev/">@mbingpdf/dev</a>
    </nav>
    <nav aria-label="Project">
      <h2>Project</h2>
      <a href="${REPO_URL}" rel="noopener">GitHub</a>
      <a href="${REPO_URL}/blob/main/CHANGELOG.md" rel="noopener">Changelog</a>
      <a href="/docs/benchmarks/">Benchmarks</a>
      <a href="${REPO_URL}/issues" rel="noopener">Report a problem</a>
    </nav>
  </div>
  <p class="foot-line"><span>mbingpdf ${escapeHtml(version)}</span><span>Made by Enterbiner Creative</span></p>
</footer>`;
}

function shell(options: ShellOptions): string {
  const title = escapeHtml(options.title);
  const description = escapeHtml(options.description);
  const url = SITE_URL + options.path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#F4F0E6">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/src/styles.css">
</head>
<body${options.bodyClass ? ` class="${options.bodyClass}"` : ""}>
<a class="skip" href="#main">Skip to content</a>
${COLORBAR}
${header(options.version, options.current)}
${options.body}
${(options.scripts ?? ["/src/site.ts"]).map((src) => `<script type="module" src="${src}"></script>`).join("\n")}
</body>
</html>
`;
}

const install = (command: string): string =>
  `<div class="install"><span class="prompt" aria-hidden="true">$</span><code>${escapeHtml(command)}</code>` +
  `<button type="button" class="copy" data-copy="${escapeHtml(command)}" aria-label="Copy the command">${COPY}<span>Copy</span></button></div>`;

const kilobytes = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB`;

/** The benchmark figures of docs/benchmarks.md (2026-11-10, Node 26, Core i7-8565U). */
const BENCHMARKS: readonly {
  name: string;
  note: string;
  unit: string;
  rows: readonly [library: string, value: number, label: string, size: string][];
}[] = [
  {
    name: "Invoice",
    note: "one page, a table of 12 lines",
    unit: "ms",
    rows: [
      ["mbingpdf", 22, "22 ms", "18.3 kB"],
      ["@react-pdf/renderer", 72, "72 ms", "20.4 kB"],
      ["pdfmake", 77, "77 ms", "19.8 kB"],
      ["PDFKit", 293, "293 ms", "19.4 kB"],
    ],
  },
  {
    name: "Long table",
    note: "2,000 rows, header on every page",
    unit: "s",
    rows: [
      ["pdfmake", 1.02, "1.02 s", "250.3 kB"],
      ["mbingpdf", 1.9, "1.90 s", "156.4 kB"],
      ["@react-pdf/renderer", 25.93, "25.93 s", "313.1 kB"],
      ["PDFKit", 29.1, "29.10 s", "248.6 kB"],
    ],
  },
  {
    name: "Running text",
    note: "300 paragraphs, 24 pages",
    unit: "ms",
    rows: [
      ["PDFKit", 261, "261 ms", "87.8 kB"],
      ["mbingpdf", 468, "468 ms", "80.1 kB"],
      ["pdfmake", 677, "677 ms", "219.7 kB"],
      ["@react-pdf/renderer", 1600, "1.60 s", "116.7 kB"],
    ],
  },
];

const FEATURES: readonly [title: string, text: string, api: string][] = [
  [
    "Layout that paginates",
    "Rows and stacks sized like flexbox, tables that repeat their header, columns, grids. Content breaks across pages by itself, keeps headings with their text, and knows “page 3 of 12”.",
    "Row · Stack · Table · Columns · Grid",
  ],
  [
    "Type, measured",
    "Reads TrueType, OpenType and variable fonts and embeds only the glyphs used. Ligatures, kerning and accents match HarfBuzz. Hyphenation for English and Indonesian.",
    "Font · instance() · hyphenate · fit · truncate",
  ],
  [
    "Ready for the press",
    "CMYK and spot colours, bleed, crop and registration marks, an ICC output intent and PDF/X-4. The file a print shop asks for, not a screenshot of a web page.",
    "cmyk() · spot() · bleed · marks · PDF/X-4",
  ],
  [
    "Archival and accessible",
    "PDF/A-2 and A-3 for the archive; tagged PDF and PDF/UA-1 for screen readers, built from the elements you already wrote. Every level is validated with veraPDF in CI.",
    "conformance · tagged · alt · role",
  ],
  [
    "Charts, barcodes, QR",
    "Bar, line and pie charts as vectors in the document's own font. Code 128, EAN-13, ITF and QR codes, each one decoded again by two independent scanners in the tests.",
    "BarChart · LineChart · PieChart · Barcode · QrCode",
  ],
  [
    "Locked when it must be",
    "AES-256 passwords and permissions. Files carried inside the PDF, including the XML of a Factur-X e-invoice in a PDF/A-3 file.",
    "encryption · attachments · facturX()",
  ],
  [
    "Seen before it is printed",
    "The same layout drawn as SVG: a preview component for React and for Vue, and a dev server that redraws your document every time you save.",
    "PdfPreview · usePdf · mbingpdf dev",
  ],
  [
    "The same bytes everywhere",
    "No DOM, no canvas, no native code, no dependencies. Node, Bun, Deno, browsers and workers produce byte-identical files, checked on every commit.",
    "render() · render.sync() · deterministic",
  ],
];

function gallery(showcase: readonly Showcase[]): string {
  const piece = (
    item: Showcase,
  ): string => `<figure class="piece" style="--ratio:${item.ratio.toFixed(4)}">
      <a class="sheet" href="/playground/#${item.id}" aria-label="Open the ${escapeHtml(item.title.toLowerCase())} in the playground">
        <img src="/gallery/${item.id}.svg" alt="${escapeHtml(item.title)}: ${escapeHtml(item.caption.toLowerCase())}" loading="lazy" decoding="async">
      </a>
      <figcaption>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.caption)}</span>
        <span class="spec">${escapeHtml(item.paper)} · ${item.pages === 1 ? "1 page" : `${item.pages} pages`} · ${kilobytes(item.bytes)}</span>
        <span class="links"><a href="/playground/#${item.id}">Edit it ${ARROW}</a><a href="/gallery/${item.id}.pdf">PDF</a></span>
      </figcaption>
    </figure>`;
  // Two rows, each of sheets the same height: the wide ones, then the tall ones.
  const wide = showcase.filter((item) => item.ratio > 1);
  const tall = showcase.filter((item) => item.ratio <= 1);
  return [wide, tall]
    .map((row) => `<div class="piece-row">\n${row.map(piece).join("\n")}\n</div>`)
    .join("\n");
}

function benchmarks(): string {
  return BENCHMARKS.map((set) => {
    const slowest = Math.max(...set.rows.map(([, value]) => value));
    const rows = set.rows
      .map(([library, value, label, size]) => {
        // The square root keeps a 29-second bar from flattening a 1-second one to nothing.
        const width = Math.max(1.5, Math.sqrt(value / slowest) * 100);
        const ours = library === "mbingpdf";
        return `<tr${ours ? ' class="ours"' : ""}><th scope="row">${escapeHtml(library)}</th><td class="bar"><i style="width:${width.toFixed(1)}%"></i></td><td class="num">${label}</td><td class="num size">${size}</td></tr>`;
      })
      .join("");
    return `<div class="bench">
      <h3>${escapeHtml(set.name)} <span>${escapeHtml(set.note)}</span></h3>
      <table><thead><tr><th scope="col">Library</th><th scope="col"><span class="visually-hidden">Time, drawn</span></th><th scope="col" class="num">Time</th><th scope="col" class="num">File</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join("\n");
}

export function homePage(data: {
  version: string;
  showcase: readonly Showcase[];
  snippet: string;
  /** Width over height of the certificate's press sheet, marks included. */
  pressRatio: number;
}): string {
  const find = (id: string): Showcase => data.showcase.find((item) => item.id === id) as Showcase;
  const certificate = find("certificate");
  const invoice = find("invoice");
  const bib = find("bib");
  const body = `<main id="main">
<section class="hero">
  <div class="hero-copy">
    <h1>Documents,<br>typeset<br>in code<span class="dot">.</span></h1>
    <p class="lead">mbingpdf turns a description of a document into a print-ready PDF: in the browser, on a server, at the edge. It measures every glyph itself, so the same input gives the same file everywhere.</p>
    ${install("npm install mbingpdf")}
    <p class="actions">
      <a class="button" href="/playground/">Open the playground ${ARROW}</a>
      <a class="link" href="/docs/quick-start/">Read the quick start</a>
    </p>
  </div>
  <div class="hero-art">
    <div class="hero-stack">
      <a class="sheet sheet-back-left" href="/playground/#invoice" style="--ratio:${invoice.ratio.toFixed(4)}" tabindex="-1" aria-hidden="true"><img src="/gallery/invoice.svg" alt="" decoding="async"></a>
      <a class="sheet sheet-back-right" href="/playground/#bib" style="--ratio:${bib.ratio.toFixed(4)}" tabindex="-1" aria-hidden="true"><img src="/gallery/bib.svg" alt="" decoding="async"></a>
      <a class="sheet sheet-front" href="/playground/#certificate" style="--ratio:${data.pressRatio.toFixed(4)}"><img src="/gallery/certificate-sheet.png" alt="A certificate on its press sheet, with bleed, crop marks and registration marks, as mbingpdf wrote it" decoding="async" fetchpriority="high"></a>
    </div>
    <p class="plate"><span>A4 landscape</span><span>3 mm bleed</span><span>crop + registration marks</span><span>${kilobytes(certificate.bytes)} · ${Math.round(certificate.milliseconds)} ms</span></p>
  </div>
</section>

<section class="figures" aria-label="In numbers">
  <div><b>22<small>ms</small></b><p>for a one-page invoice with an embedded font. Three times faster than the next library we measured.</p></div>
  <div><b>0</b><p>runtime dependencies. No headless browser, no native binary, nothing to install on the server.</p></div>
  <div><b>5,000</b><p>race bibs in one file, each font embedded once, in a test that runs on every commit.</p></div>
  <div><b>4<small class="to">→</small>1</b><p>Node, Bun, Deno and browsers write the same bytes. One output, wherever it runs.</p></div>
</section>

<section class="split" id="how">
  <div class="section-head">
    <p class="label">01 — How it reads</p>
    <h2>You describe the page.<br>It works out the rest.</h2>
    <p>Elements are functions; a document is what they return. No template language, no coordinates, no build step. The receipt on the right is exactly what the code on the left produces: it was laid out when this page was built.</p>
  </div>
  <div class="demo">
    <div class="code demo-code">${data.snippet}</div>
    <div class="demo-result">
      <div class="sheet" style="--ratio:${(80 / 96).toFixed(4)}"><img src="/gallery/hello.svg" alt="A small receipt: a heading, two lines, a total and a QR code" loading="lazy" decoding="async"></div>
    </div>
  </div>
</section>

<section class="features" id="features">
  <div class="section-head">
    <p class="label">02 — What is in the box</p>
    <h2>Everything a real document needs.</h2>
  </div>
  <ol class="feature-grid">
    ${FEATURES.map(
      ([title, text, api], i) =>
        `<li><span class="index">${String(i + 1).padStart(2, "0")}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p><code>${escapeHtml(api)}</code></li>`,
    ).join("\n    ")}
  </ol>
</section>

<section class="gallery" id="gallery">
  <div class="section-head">
    <p class="label">03 — Made with it</p>
    <h2>Six documents. Open any of them and change it.</h2>
    <p>These are not screenshots. Each picture is the library's own output, drawn as vectors; each opens in the playground with its source.</p>
  </div>
  <div class="pieces">
${gallery(data.showcase)}
  </div>
</section>

<section class="numbers" id="benchmarks">
  <div class="section-head">
    <p class="label">04 — Measured</p>
    <h2>Fast where it counts.<br>Honest where it is not.</h2>
    <p>Three documents, built by four libraries from the same data with the same font. mbingpdf writes the smallest file in all three and is the fastest on the invoice. It is not the fastest everywhere: pdfmake lays out a 2,000-row table in half the time, and PDFKit sets plain paragraphs faster. <a href="/docs/benchmarks/">Method and full results</a>.</p>
  </div>
  <div class="bench-grid">
${benchmarks()}
  </div>
  <p class="footnote">Median of three runs, 10 November 2026, Node 26 on an Intel Core i7-8565U laptop. Times vary by 10–30% between runs.</p>
</section>

<section class="start" id="start">
  <div class="section-head">
    <p class="label">05 — Start</p>
    <h2>One package. Three more if you want them.</h2>
  </div>
  <div class="packages">
    <div class="package package-main">
      <h3><a href="/docs/quick-start/">mbingpdf</a></h3>
      <p>The engine: elements, layout, fonts, images, charts, barcodes, standards. Works on its own.</p>
      ${install("npm install mbingpdf")}
    </div>
    <a class="package" href="/docs/react/"><h3>@mbingpdf/react</h3><p>A preview component and a hook that makes the file.</p><span>Read ${ARROW}</span></a>
    <a class="package" href="/docs/vue/"><h3>@mbingpdf/vue</h3><p>The same for Vue and Nuxt.</p><span>Read ${ARROW}</span></a>
    <a class="package" href="/docs/dev/"><h3>@mbingpdf/dev</h3><p>A preview server that redraws on every save.</p><span>Read ${ARROW}</span></a>
  </div>
  <p class="runtimes"><span>Runs on</span><b>Browsers</b><b>Node 22+</b><b>Bun</b><b>Deno</b><b>Workers</b></p>
</section>
</main>
${footer(data.version)}`;
  return shell({
    title: "mbingpdf — documents, typeset in code",
    description:
      "A TypeScript library that turns a description of a document into a print-ready PDF, in browsers and on servers. No dependencies, no headless browser.",
    path: "/",
    version: data.version,
    body,
    bodyClass: "home",
  });
}

export function playgroundPage(data: { version: string; showcase: readonly Showcase[] }): string {
  const tabs = data.showcase
    .map(
      (item, i) =>
        `<button type="button" role="tab" data-template="${item.id}" aria-selected="${i === 0}">${escapeHtml(item.title)}</button>`,
    )
    .join("");
  const body = `<main id="main" class="play">
  <div class="play-bar">
    <div class="play-tabs" role="tablist" aria-label="Templates">${tabs}</div>
    <div class="play-tools">
      <button type="button" class="plain" id="reset">Reset</button>
      <label class="toggle"><input type="checkbox" id="outline"><span>Outline boxes</span></label>
      <button type="button" class="button button-small" id="download">Download PDF</button>
    </div>
  </div>
  <div class="play-panes">
    <section class="play-editor" aria-label="Source">
      <div id="editor"></div>
      <pre class="play-error" id="error" role="alert" hidden></pre>
    </section>
    <section class="play-preview" aria-label="Preview" aria-live="polite">
      <div id="pages" class="play-pages"><p class="play-loading">Loading fonts…</p></div>
    </section>
  </div>
  <p class="play-status"><span id="status">&nbsp;</span><span class="play-hint">The code is the body of a function that returns a <code>Document</code>. Every export of <code>mbingpdf</code> is in scope, with <code>fonts.jakarta</code>, <code>fonts.barlow</code> and <code>fonts.mono</code>. It runs in your browser; nothing is sent anywhere.</span></p>
</main>`;
  return shell({
    title: "Playground — mbingpdf",
    description:
      "Edit a document and watch the PDF change. mbingpdf runs entirely in your browser.",
    path: "/playground/",
    version: data.version,
    body,
    current: "playground",
    bodyClass: "app",
    scripts: ["/src/site.ts", "/src/playground.ts"],
  });
}

export function docsPage(data: {
  version: string;
  slug: string;
  title: string;
  description: string;
  html: string;
  headings: readonly Heading[];
  navigation: readonly { slug: string; title: string; group: string }[];
  source: string;
}): string {
  const groups = [...new Set(data.navigation.map((item) => item.group))];
  const sidebar = groups
    .map(
      (group) =>
        `<h2>${escapeHtml(group)}</h2>` +
        data.navigation
          .filter((item) => item.group === group)
          .map(
            (item) =>
              `<a href="/docs/${item.slug}/"${item.slug === data.slug ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a>`,
          )
          .join(""),
    )
    .join("");
  const index = data.navigation.findIndex((item) => item.slug === data.slug);
  const previous = data.navigation[index - 1];
  const next = data.navigation[index + 1];
  const contents = data.headings
    .filter((heading) => heading.depth === 2)
    .map((heading) => `<a href="#${heading.id}">${heading.text}</a>`)
    .join("");
  const body = `<div class="docs">
  <aside class="docs-nav">
    <details open>
      <summary>Documentation</summary>
      <nav aria-label="Documentation">${sidebar}</nav>
    </details>
  </aside>
  <main id="main" class="prose">
    <p class="label">${escapeHtml(data.navigation[index]?.group ?? "Docs")}</p>
    <h1>${escapeHtml(data.title)}</h1>
    ${data.html}
    <nav class="pager" aria-label="More pages">
      ${previous ? `<a class="pager-previous" href="/docs/${previous.slug}/"><span>Previous</span>${escapeHtml(previous.title)}</a>` : "<span></span>"}
      ${next ? `<a class="pager-next" href="/docs/${next.slug}/"><span>Next</span>${escapeHtml(next.title)}</a>` : "<span></span>"}
    </nav>
    <p class="edit"><a href="${data.source}" rel="noopener">Edit this page on GitHub</a></p>
  </main>
  ${contents ? `<aside class="docs-toc"><nav aria-label="On this page"><h2>On this page</h2>${contents}</nav></aside>` : '<aside class="docs-toc"></aside>'}
</div>
${footer(data.version)}`;
  return shell({
    title: `${data.title} — mbingpdf`,
    description: data.description,
    path: `/docs/${data.slug}/`,
    version: data.version,
    body,
    current: data.slug === "benchmarks" ? "benchmarks" : "docs",
    bodyClass: "doc",
  });
}

export function notFoundPage(data: { version: string }): string {
  const body = `<main id="main" class="missing">
  <p class="label">404</p>
  <h1>This page is<br>off the sheet<span class="dot">.</span></h1>
  <p class="lead">Nothing is printed at this address.</p>
  <p class="actions"><a class="button" href="/">Back to the start ${ARROW}</a><a class="link" href="/docs/quick-start/">Read the docs</a></p>
</main>
${footer(data.version)}`;
  return shell({
    title: "Not found — mbingpdf",
    description: "This page does not exist.",
    path: "/404.html",
    version: data.version,
    body,
    bodyClass: "home",
  });
}
