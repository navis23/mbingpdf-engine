// Measures what each entry point of the built package costs to load, and fails when one grows
// past its budget in size-budget.json.
//
//   node scripts/size.mjs            check against the budget
//   node scripts/size.mjs --update   write the current sizes (plus headroom) as the new budget
//
// "Cost" is the gzip size of the entry file and every chunk it imports, which is what a
// browser downloads when an application uses that entry point and nothing is tree-shaken away.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const budgetFile = join(root, "size-budget.json");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Every file an entry pulls in through static imports. */
function closure(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /(?:import|export)\s[^"']*?from\s*["'](\.[^"']+)["']|import\s*["'](\.[^"']+)["']/g,
    )) {
      visit(resolve(dirname(file), match[1] ?? match[2]));
    }
  };
  visit(entry);
  return [...seen];
}

const sizes = {};
for (const [name, target] of Object.entries(manifest.exports)) {
  if (typeof target !== "object" || !target.import) continue;
  const files = closure(join(root, target.import));
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const bytes = readFileSync(file);
    raw += bytes.length;
    gzip += gzipSync(bytes, { level: 9 }).length;
  }
  sizes[name === "." ? "mbingpdf" : `mbingpdf${name.slice(1)}`] = {
    raw,
    gzip,
    files: files.length,
  };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
if (process.argv.includes("--update")) {
  // A tenth of headroom, rounded up to half a kilobyte, so small changes do not trip the check.
  const budget = Object.fromEntries(
    Object.entries(sizes).map(([name, size]) => [name, Math.ceil((size.gzip * 1.1) / 512) * 512]),
  );
  writeFileSync(budgetFile, `${JSON.stringify(budget, null, 2)}\n`);
}
const budget = JSON.parse(readFileSync(budgetFile, "utf8"));
let failed = false;
for (const [name, size] of Object.entries(sizes)) {
  const limit = budget[name];
  const over = limit === undefined || size.gzip > limit;
  failed ||= over;
  console.log(
    `${over ? "✗" : "✓"} ${name.padEnd(26)} ${kb(size.gzip).padStart(9)} gzip  ${kb(size.raw).padStart(9)} raw  ` +
      (limit === undefined ? "(no budget set)" : `(budget ${kb(limit)})`),
  );
}
if (failed) {
  console.error(
    "\nAn entry point is over its size budget. If the growth is intended, run: node scripts/size.mjs --update",
  );
  process.exit(1);
}
