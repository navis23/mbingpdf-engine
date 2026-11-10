/** The preview page the server sends to the browser: one file, no build step, no dependencies. */
export function previewHtml(name: string): string {
  const title = name.replace(/[&<>"]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — mbingpdf</title>
<style>
  :root { color-scheme: light dark; --bar: #1f2328; --ink: #f0f3f6; --muted: #9aa4af; --desk: #e7e9ec; --bad: #ff7b72; }
  @media (prefers-color-scheme: dark) { :root { --desk: #2b2f34; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--desk); font: 13px/1.4 system-ui, sans-serif; }
  header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center;
    padding: 8px 14px; background: var(--bar); color: var(--ink); }
  header b { font-weight: 600; }
  header .muted { color: var(--muted); }
  header .grow { flex: 1; }
  header label { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
  header select, header a.button, header button { font: inherit; color: var(--ink); background: #30363d; border: 1px solid #484f58;
    border-radius: 6px; padding: 3px 9px; text-decoration: none; cursor: pointer; }
  #warnings { display: none; margin: 0; padding: 8px 14px 8px 32px; background: #3a2f12; color: #f2cc60; }
  #warnings.open { display: block; }
  #error { display: none; margin: 0; padding: 16px; background: #2d1215; color: var(--bad); white-space: pre-wrap;
    font: 12px/1.5 ui-monospace, monospace; }
  #error.open { display: block; }
  main { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px; }
  main.stale { opacity: 0.45; }
  .page { position: relative; background: white; box-shadow: 0 1px 5px rgba(0,0,0,.3); max-width: 100%; }
  .page img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .page a { position: absolute; }
  .page a:hover { outline: 1px solid rgba(9,105,218,.6); background: rgba(9,105,218,.08); }
  .number { color: #8b949e; font-size: 11px; margin-top: -10px; }
</style>
</head>
<body>
<header>
  <b>${title}</b>
  <span id="status" class="muted">loading…</span>
  <button id="warn" hidden></button>
  <span class="grow"></span>
  <label><input type="checkbox" id="debug"> Outlines</label>
  <select id="zoom" aria-label="Zoom">
    <option value="fit">Fit width</option>
    <option value="0.75">75%</option>
    <option value="1" selected>100%</option>
    <option value="1.5">150%</option>
    <option value="2">200%</option>
  </select>
  <a class="button" href="/document.pdf" target="_blank">Open PDF</a>
</header>
<ol id="warnings"></ol>
<pre id="error"></pre>
<main id="pages"></main>
<script>
const $ = (id) => document.getElementById(id);
const pages = $("pages"), statusText = $("status"), errorBox = $("error"), warn = $("warn"), warnings = $("warnings");
const debug = $("debug"), zoom = $("zoom");
let state;
try {
  debug.checked = localStorage.getItem("mbingpdf.debug") === "1";
  zoom.value = localStorage.getItem("mbingpdf.zoom") || "1";
} catch {}

function draw() {
  if (!state) return;
  errorBox.classList.toggle("open", Boolean(state.error));
  errorBox.textContent = state.error || "";
  pages.classList.toggle("stale", Boolean(state.error));
  warn.hidden = !state.warnings.length;
  warn.textContent = state.warnings.length + (state.warnings.length === 1 ? " warning" : " warnings");
  if (!state.warnings.length) warnings.classList.remove("open");
  warnings.replaceChildren(...state.warnings.map((warning) => {
    const item = document.createElement("li");
    item.textContent = warning.message + (warning.path ? "  —  " + warning.path : "");
    return item;
  }));
  // After an error the last good pages stay on screen, dimmed.
  if (state.error) { statusText.textContent = "error"; return; }
  statusText.textContent = state.pages.length + (state.pages.length === 1 ? " page" : " pages") + " · " + state.ms + " ms";
  const scale = zoom.value === "fit" ? null : Number(zoom.value) * (96 / 72);
  const query = "?v=" + state.version + (debug.checked ? "&debug=1" : "");
  const nodes = [];
  state.pages.forEach((page, index) => {
    // Existing elements are reused, so the scroll position holds while pages are redrawn.
    const sheet = pages.querySelector('[data-page="' + (index + 1) + '"]') || document.createElement("div");
    sheet.className = "page";
    sheet.dataset.page = index + 1;
    sheet.style.aspectRatio = page.width + " / " + page.height;
    sheet.style.width = scale ? page.width * scale + "px" : "100%";
    let image = sheet.querySelector("img");
    if (!image) { image = document.createElement("img"); image.loading = "lazy"; image.alt = "Page " + (index + 1); sheet.append(image); }
    image.src = "/page/" + (index + 1) + ".svg" + query;
    sheet.querySelectorAll("a").forEach((link) => link.remove());
    for (const link of page.links) {
      const a = document.createElement("a");
      if (link.url) { a.href = link.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = link.url; }
      else { a.href = "#" + link.target; a.title = "To: " + link.target; a.addEventListener("click", (event) => { event.preventDefault(); go(link.target); }); }
      a.style.left = (link.x / page.width) * 100 + "%";
      a.style.top = (link.y / page.height) * 100 + "%";
      a.style.width = (link.width / page.width) * 100 + "%";
      a.style.height = (link.height / page.height) * 100 + "%";
      sheet.append(a);
    }
    const number = document.createElement("div");
    number.className = "number";
    number.textContent = (index + 1) + " / " + state.pages.length;
    nodes.push(sheet, number);
  });
  pages.replaceChildren(...nodes);
}

function go(target) {
  state.pages.forEach((page, index) => {
    const anchor = page.anchors.find((a) => a.id === target);
    if (!anchor) return;
    const sheet = pages.querySelector('[data-page="' + (index + 1) + '"]');
    const box = sheet.getBoundingClientRect();
    scrollTo({ top: scrollY + box.top + (anchor.y / page.height) * box.height - 60, behavior: "smooth" });
  });
}

async function refresh() {
  state = await (await fetch("/state" + (debug.checked ? "?debug=1" : ""))).json();
  draw();
}

debug.addEventListener("change", () => { try { localStorage.setItem("mbingpdf.debug", debug.checked ? "1" : "0"); } catch {} refresh(); });
zoom.addEventListener("change", () => { try { localStorage.setItem("mbingpdf.zoom", zoom.value); } catch {} draw(); });
warn.addEventListener("click", () => warnings.classList.toggle("open"));

const events = new EventSource("/events");
events.addEventListener("change", refresh);
events.onerror = () => { statusText.textContent = "disconnected — is the server still running?"; };
events.onopen = refresh;
</script>
</body>
</html>`;
}
