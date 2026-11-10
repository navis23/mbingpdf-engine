// Compares mbingpdf with PDFKit, pdfmake and @react-pdf/renderer on three documents:
//
//   invoice  one page: a heading, an address block and a table of 12 lines with totals
//   table    2,000 rows in 5 columns over many pages, the header repeated on each
//   text     300 paragraphs of about 80 words, with a heading every tenth
//
// Each library builds the same content with the same embedded font, using its own table
// and text features as its documentation recommends. The time is the median of several runs
// after a warm-up, in one Node process; the size is that of the finished file.
//
//   pnpm build && pnpm --filter mbingpdf-benchmarks bench            all documents
//   pnpm --filter mbingpdf-benchmarks bench -- table --runs 3        one document, 3 runs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const fontPath = (name) =>
  fileURLToPath(new URL(`../packages/mbingpdf/test/fonts/${name}`, import.meta.url));
const REGULAR = fontPath("BarlowCondensed-Regular.ttf");
const BOLD = fontPath("BarlowCondensed-Bold.ttf");

// ----- the content, the same for every library -----

/** A small repeatable random generator, so every run sees the same data. */
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const WORDS =
  "the document layout engine breaks lines measures text places tables across pages and writes compact files for print and screen with fonts images colour vector artwork headers footers numbers totals".split(
    " ",
  );

function sentence(next, words) {
  const out = [];
  for (let i = 0; i < words; i++) out.push(WORDS[Math.floor(next() * WORDS.length)]);
  const text = out.join(" ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

const money = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 2 });

function invoiceData() {
  const next = random(1);
  const lines = Array.from({ length: 12 }, (_, i) => {
    const quantity = 1 + Math.floor(next() * 20);
    const price = Math.round(next() * 500_00) / 100;
    return [
      String(i + 1),
      sentence(next, 5),
      String(quantity),
      money(price),
      money(quantity * price),
    ];
  });
  return {
    title: "INVOICE INV-2026-0042",
    from: ["Example Company Ltd", "17 Example Street", "Example City 40111"],
    to: ["Customer Organisation", "8 Sample Road", "Sample Town 40112"],
    header: ["#", "Description", "Qty", "Unit price", "Amount"],
    lines,
    total: ["", "", "", "Total", "61,234.50"],
  };
}

function tableData() {
  const next = random(2);
  return {
    header: ["No", "Name", "Category", "Date", "Amount"],
    rows: Array.from({ length: 2000 }, (_, i) => [
      String(i + 1),
      sentence(next, 3),
      WORDS[Math.floor(next() * WORDS.length)],
      `2026-${String(1 + Math.floor(next() * 12)).padStart(2, "0")}-${String(1 + Math.floor(next() * 28)).padStart(2, "0")}`,
      money(Math.round(next() * 1_000_000) / 100),
    ]),
  };
}

function textData() {
  const next = random(3);
  return Array.from({ length: 300 }, (_, i) => ({
    heading: i % 10 === 0 ? `Section ${i / 10 + 1}` : undefined,
    body: Array.from({ length: 5 }, () => sentence(next, 16)).join(" "),
  }));
}

const MARGIN = 40;
/** Column widths in points; the table is 515 wide on A4 with 40 pt margins. */
const INVOICE_WIDTHS = [25, 250, 50, 90, 100];
const TABLE_WIDTHS = [45, 200, 100, 80, 90];

// ----- mbingpdf -----

async function mbingpdf() {
  const { Document, Font, Heading, Page, Row, Stack, Table, Text, render } = await import(
    "mbingpdf"
  );
  const regular = new Font(new Uint8Array(readFileSync(REGULAR)));
  const bold = new Font(new Uint8Array(readFileSync(BOLD)));
  const page = (...children) =>
    Document(
      { font: regular, size: 10 },
      Page({ size: "A4", margin: MARGIN, gap: 8 }, ...children),
    );
  const columns = (widths, rightFrom = 2) =>
    widths.map((width, i) => ({ width, ...(i >= rightFrom ? { align: "end" } : {}) }));
  return {
    name: "mbingpdf",
    version: require("mbingpdf/package.json").version,
    invoice: (data) =>
      render(
        page(
          Text({ font: bold, size: 20 }, data.title),
          Row(
            { gap: 20 },
            Stack({ grow: 1 }, ...data.from.map((line) => Text(line))),
            Stack({ grow: 1 }, ...data.to.map((line) => Text(line))),
          ),
          Table({
            columns: columns(INVOICE_WIDTHS),
            header: data.header,
            headerStyle: { font: bold },
            rows: data.lines,
            footer: [data.total],
            footerStyle: { font: bold },
          }),
        ),
      ),
    table: (data) =>
      render(
        page(
          Table({
            columns: columns(TABLE_WIDTHS, 4),
            header: data.header,
            headerStyle: { font: bold },
            rows: data.rows,
          }),
        ),
      ),
    text: (data) =>
      render(
        page(
          ...data.flatMap((item) => [
            ...(item.heading ? [Heading({ font: bold, size: 16 }, item.heading)] : []),
            Text(item.body),
          ]),
        ),
      ),
  };
}

// ----- PDFKit -----

async function pdfkit() {
  const { default: PDFDocument } = await import("pdfkit");
  const build = (draw) =>
    new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: MARGIN });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.registerFont("regular", REGULAR);
      doc.registerFont("bold", BOLD);
      doc.font("regular").fontSize(10);
      draw(doc);
      doc.end();
    });
  const table = (doc, widths, header, rows, rightFrom, footer) => {
    const cell = (text, i, font) => ({
      text,
      font: { src: font },
      align: i >= rightFrom ? "right" : "left",
    });
    doc.table({
      columnStyles: widths,
      rowStyles: { border: [0, 0, 0.5, 0], padding: 4 },
      data: [
        header.map((text, i) => cell(text, i, "bold")),
        ...rows.map((row) => row.map((text, i) => cell(text, i, "regular"))),
        ...(footer ? [footer.map((text, i) => cell(text, i, "bold"))] : []),
      ],
    });
  };
  return {
    name: "PDFKit",
    version: require("pdfkit/package.json").version,
    invoice: (data) =>
      build((doc) => {
        doc.font("bold").fontSize(20).text(data.title).moveDown(0.4);
        doc.font("regular").fontSize(10);
        const top = doc.y;
        doc.text(data.from.join("\n"), MARGIN, top, { width: 250 });
        doc.text(data.to.join("\n"), MARGIN + 265, top, { width: 250 });
        doc.x = MARGIN;
        doc.moveDown(1);
        table(doc, INVOICE_WIDTHS, data.header, data.lines, 2, data.total);
      }),
    table: (data) => build((doc) => table(doc, TABLE_WIDTHS, data.header, data.rows, 4)),
    text: (data) =>
      build((doc) => {
        for (const item of data) {
          if (item.heading) doc.font("bold").fontSize(16).text(item.heading).moveDown(0.3);
          doc.font("regular").fontSize(10).text(item.body).moveDown(0.6);
        }
      }),
  };
}

// ----- pdfmake -----

async function pdfmake() {
  const { default: PdfPrinter } = await import("pdfmake");
  const printer = new PdfPrinter({
    Barlow: { normal: REGULAR, bold: BOLD, italics: REGULAR, bolditalics: BOLD },
  });
  const build = (content) =>
    new Promise((resolve, reject) => {
      const doc = printer.createPdfKitDocument({
        pageSize: "A4",
        pageMargins: MARGIN,
        defaultStyle: { font: "Barlow", fontSize: 10 },
        content,
      });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    });
  const table = (widths, header, rows, rightFrom, footer) => {
    const cell = (text, i, bold) => ({
      text,
      bold,
      alignment: i >= rightFrom ? "right" : "left",
    });
    return {
      layout: "lightHorizontalLines",
      table: {
        headerRows: 1,
        // pdfmake adds padding to each column; the widths leave room for it.
        widths: widths.map((width) => width - 8),
        body: [
          header.map((text, i) => cell(text, i, true)),
          ...rows.map((row) => row.map((text, i) => cell(text, i, false))),
          ...(footer ? [footer.map((text, i) => cell(text, i, true))] : []),
        ],
      },
    };
  };
  return {
    name: "pdfmake",
    version: require("pdfmake/package.json").version,
    invoice: (data) =>
      build([
        { text: data.title, fontSize: 20, bold: true, margin: [0, 0, 0, 8] },
        {
          columns: [{ text: data.from.join("\n") }, { text: data.to.join("\n") }],
          margin: [0, 0, 0, 8],
        },
        table(INVOICE_WIDTHS, data.header, data.lines, 2, data.total),
      ]),
    table: (data) => build([table(TABLE_WIDTHS, data.header, data.rows, 4)]),
    text: (data) =>
      build(
        data.flatMap((item) => [
          ...(item.heading
            ? [{ text: item.heading, fontSize: 16, bold: true, margin: [0, 0, 0, 4] }]
            : []),
          { text: item.body, margin: [0, 0, 0, 8] },
        ]),
      ),
  };
}

// ----- @react-pdf/renderer -----

async function reactPdf() {
  const { createElement: h } = await import("react");
  const { Document, Font, Page, Text, View, renderToBuffer } = await import("@react-pdf/renderer");
  Font.register({
    family: "Barlow",
    fonts: [{ src: REGULAR }, { src: BOLD, fontWeight: 700 }],
  });
  // Hyphenation is off in the other libraries too.
  Font.registerHyphenationCallback((word) => [word]);
  const page = (...children) =>
    h(
      Document,
      null,
      h(
        Page,
        { size: "A4", style: { padding: MARGIN, fontFamily: "Barlow", fontSize: 10 } },
        ...children,
      ),
    );
  const row = (widths, cells, rightFrom, bold, key, fixed = false) =>
    h(
      View,
      {
        key,
        fixed,
        wrap: false,
        style: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#999" },
      },
      ...cells.map((text, i) =>
        h(
          Text,
          {
            key: i,
            style: {
              width: widths[i],
              padding: 4,
              textAlign: i >= rightFrom ? "right" : "left",
              ...(bold ? { fontWeight: 700 } : {}),
            },
          },
          text,
        ),
      ),
    );
  const table = (widths, header, rows, rightFrom, footer) => [
    row(widths, header, rightFrom, true, "header", true),
    ...rows.map((cells, i) => row(widths, cells, rightFrom, false, i)),
    ...(footer ? [row(widths, footer, rightFrom, true, "footer")] : []),
  ];
  return {
    name: "@react-pdf/renderer",
    version: require("@react-pdf/renderer/package.json").version,
    invoice: (data) =>
      renderToBuffer(
        page(
          h(Text, { style: { fontSize: 20, fontWeight: 700, marginBottom: 8 } }, data.title),
          h(
            View,
            { style: { flexDirection: "row", marginBottom: 8 } },
            h(Text, { style: { flex: 1 } }, data.from.join("\n")),
            h(Text, { style: { flex: 1 } }, data.to.join("\n")),
          ),
          ...table(INVOICE_WIDTHS, data.header, data.lines, 2, data.total),
        ),
      ),
    table: (data) => renderToBuffer(page(...table(TABLE_WIDTHS, data.header, data.rows, 4))),
    text: (data) =>
      renderToBuffer(
        page(
          ...data.flatMap((item, i) => [
            ...(item.heading
              ? [
                  h(
                    Text,
                    { key: `h${i}`, style: { fontSize: 16, fontWeight: 700, marginBottom: 4 } },
                    item.heading,
                  ),
                ]
              : []),
            h(Text, { key: i, style: { marginBottom: 8 } }, item.body),
          ]),
        ),
      ),
  };
}

// ----- measuring -----

/** The number of pages, asked of poppler's pdfinfo when it is installed. */
const pageCount = (bytes) => {
  const dir = mkdtempSync(join(tmpdir(), "mbingpdf-bench-"));
  try {
    const file = join(dir, "out.pdf");
    writeFileSync(file, bytes);
    const info = spawnSync("pdfinfo", [file], { encoding: "utf8" });
    const match = /^Pages:\s+(\d+)/m.exec(info.stdout ?? "");
    return match ? Number(match[1]) : undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

async function measure(make, data, runs) {
  let bytes = await make(data); // warm-up: loads code, fills caches
  const times = [];
  for (let i = 0; i < runs; i++) {
    globalThis.gc?.();
    const start = performance.now();
    bytes = await make(data);
    times.push(performance.now() - start);
  }
  return { ms: median(times), bytes: bytes.length, pages: pageCount(bytes) };
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const runsAt = args.indexOf("--runs");
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 5;
const outAt = args.indexOf("--out");
const outDir = outAt >= 0 ? args[outAt + 1] : undefined;
const wanted = args.filter(
  (arg, i) => !arg.startsWith("--") && i !== runsAt + 1 && i !== outAt + 1,
);

const documents = { invoice: invoiceData(), table: tableData(), text: textData() };
const descriptions = {
  invoice: "Invoice, 1 page",
  table: "Table, 2,000 rows",
  text: "Text, 300 paragraphs",
};
const libraries = [await mbingpdf(), await pdfkit(), await pdfmake(), await reactPdf()];

console.log(
  `Node ${process.version}, ${cpus()[0]?.model ?? "unknown CPU"}, median of ${runs} runs\n`,
);
console.log(
  `Versions: ${libraries.map((library) => `${library.name} ${library.version}`).join(", ")}\n`,
);

for (const [key, data] of Object.entries(documents)) {
  if (wanted.length > 0 && !wanted.includes(key)) continue;
  console.log(`### ${descriptions[key]}\n`);
  console.log("| Library | Time | File size | Pages |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const library of libraries) {
    try {
      if (outDir) {
        mkdirSync(outDir, { recursive: true });
        const slug = library.name.replace(/[^a-z]/gi, "").toLowerCase();
        writeFileSync(`${outDir}/${key}-${slug}.pdf`, await library[key](data));
      }
      const result = await measure(library[key], data, runs);
      const time =
        result.ms >= 1000 ? `${(result.ms / 1000).toFixed(2)} s` : `${result.ms.toFixed(0)} ms`;
      console.log(
        `| ${library.name} | ${time} | ${(result.bytes / 1024).toFixed(1)} kB | ${result.pages ?? "?"} |`,
      );
    } catch (error) {
      console.log(
        `| ${library.name} | failed: ${String(error?.message ?? error).split("\n")[0]} | | |`,
      );
    }
  }
  console.log("");
}
