/**
 * The playground: an editor on one side, the document on the other, laid out again a moment
 * after every keystroke. Everything happens in this page; no code or document leaves it.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import * as library from "mbingpdf";
import { previewPages } from "mbingpdf/svg";

const sources = import.meta.glob<string>("../templates/*.js", {
  query: "?raw",
  import: "default",
  eager: true,
});
const templates = new Map<string, string>(
  Object.entries(sources).map(([path, code]) => [path.replace(/^.*\/|\.js$/g, ""), code]),
);

const FONT_FILES = {
  jakarta: "PlusJakartaSans-Variable.ttf",
  barlow: "BarlowCondensed-Bold.ttf",
  mono: "JetBrainsMono-Variable.ttf",
} as const;

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const pagesElement = element<HTMLDivElement>("pages");
const errorElement = element<HTMLPreElement>("error");
const statusElement = element<HTMLSpanElement>("status");
const outline = element<HTMLInputElement>("outline");
const download = element<HTMLButtonElement>("download");
const reset = element<HTMLButtonElement>("reset");
const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-template]")];

// ----- the editor, in the site's ink colours -----

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "#14110f", color: "#ede8dc", fontSize: "13px" },
    ".cm-content": {
      fontFamily: "var(--mono)",
      padding: "16px 0",
      caretColor: "#ffffff",
      lineHeight: "1.7",
    },
    ".cm-scroller": { fontFamily: "var(--mono)" },
    ".cm-gutters": { backgroundColor: "#14110f", color: "#5c574e", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 18px" },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 4%)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#ede8dc" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#ffffff" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "#2238ff99",
    },
    ".cm-matchingBracket": { backgroundColor: "rgb(255 255 255 / 14%)", outline: "none" },
  },
  { dark: true },
);

const highlighting = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#8a8478" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "#f0c674" },
  { tag: [tags.number, tags.bool, tags.null], color: "#ff9e80" },
  { tag: [tags.keyword, tags.operatorKeyword, tags.definitionKeyword], color: "#93a4ff" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#ffffff" },
  { tag: [tags.propertyName], color: "#c9c3b5" },
  { tag: [tags.punctuation, tags.operator, tags.bracket], color: "#a39d90" },
]);

const versions = new Map<string, string>();
let current = templates.has(location.hash.slice(1)) ? location.hash.slice(1) : "certificate";
if (!templates.has(current)) current = [...templates.keys()][0] as string;

const view = new EditorView({
  parent: element("editor"),
  state: EditorState.create({
    doc: templates.get(current) ?? "",
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      indentUnit.of("  "),
      EditorState.tabSize.of(2),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      javascript(),
      syntaxHighlighting(highlighting),
      theme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) schedule();
      }),
    ],
  }),
});

// ----- running the code -----

const names = Object.keys(library);
const values = names.map((name) => (library as Record<string, unknown>)[name]);
let fonts: Record<string, library.Font> | undefined;
let latest: library.LayoutNode | undefined;
let addresses: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(): void {
  clearTimeout(timer);
  for (const sheet of pagesElement.children) (sheet as HTMLElement).dataset.stale = "";
  timer = setTimeout(run, 180);
}

function fail(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  errorElement.textContent = message;
  errorElement.hidden = false;
  statusElement.textContent = "Not laid out: see the message under the code";
  for (const sheet of pagesElement.children) (sheet as HTMLElement).dataset.stale = "";
}

function run(): void {
  if (!fonts) return;
  const code = view.state.doc.toString();
  versions.set(current, code);
  let pages: ReturnType<typeof previewPages>;
  const started = performance.now();
  try {
    // Inside a block, so that the code may name a variable of its own after an export.
    const body = `{\n${code}\n}`;
    const made = new Function(...names, "fonts", body)(...values, fonts) as library.LayoutNode;
    if (made?.type !== "Document") {
      throw new Error("The code must end by returning a Document: return Document(…)");
    }
    pages = previewPages(made, { debug: outline.checked });
    latest = made;
  } catch (error) {
    fail(error);
    return;
  }
  const elapsed = performance.now() - started;
  errorElement.hidden = true;

  const scroll = pagesElement.parentElement?.scrollTop ?? 0;
  for (const address of addresses) URL.revokeObjectURL(address);
  addresses = [];
  pagesElement.replaceChildren(
    ...pages.map((page, i) => {
      const address = URL.createObjectURL(new Blob([page.svg()], { type: "image/svg+xml" }));
      addresses.push(address);
      const sheet = document.createElement("div");
      sheet.className = "sheet";
      sheet.style.setProperty("--ratio", String(page.width / page.height));
      sheet.style.setProperty("--points", String(page.width));
      const image = document.createElement("img");
      image.src = address;
      image.alt = `Page ${i + 1} of ${pages.length}`;
      sheet.append(image);
      return sheet;
    }),
  );
  if (pagesElement.parentElement) pagesElement.parentElement.scrollTop = scroll;
  const count = pages.length === 1 ? "1 page" : `${pages.length} pages`;
  statusElement.textContent = `${count} · laid out in ${elapsed < 10 ? elapsed.toFixed(1) : Math.round(elapsed)} ms`;
}

function select(id: string): void {
  if (!templates.has(id)) return;
  current = id;
  for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.template === id));
  const code = versions.get(id) ?? templates.get(id) ?? "";
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
  view.scrollDOM.scrollTop = 0;
  if (pagesElement.parentElement) pagesElement.parentElement.scrollTop = 0;
  window.history.replaceState(null, "", `#${id}`);
  clearTimeout(timer);
  run();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => select(tab.dataset.template ?? ""));
  tab.setAttribute("aria-selected", String(tab.dataset.template === current));
}
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (id !== current) select(id);
});
outline.addEventListener("change", run);
reset.addEventListener("click", () => {
  // Back to the template as it came.
  versions.delete(current);
  select(current);
});

download.addEventListener("click", async () => {
  if (!latest) return;
  download.disabled = true;
  try {
    const started = performance.now();
    const bytes = await library.render(latest, { debug: outline.checked });
    const elapsed = Math.round(performance.now() - started);
    const address = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = address;
    link.download = `${current}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(address), 0);
    statusElement.textContent = `${current}.pdf · ${(bytes.length / 1000).toFixed(1)} kB · written in ${elapsed} ms`;
  } catch (error) {
    fail(error);
  } finally {
    download.disabled = false;
  }
});

// ----- fonts, then the first layout -----

async function loadFonts(): Promise<void> {
  const entries = await Promise.all(
    Object.entries(FONT_FILES).map(async ([name, file]) => {
      const response = await fetch(`/fonts/${file}`);
      if (!response.ok) throw new Error(`Could not load the font ${file}`);
      return [name, new library.Font(new Uint8Array(await response.arrayBuffer()))] as const;
    }),
  );
  fonts = Object.fromEntries(entries);
}

loadFonts().then(run, fail);
