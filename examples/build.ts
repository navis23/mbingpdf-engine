/** Builds every starter template into `examples/out/`. Run with `pnpm --filter mbingpdf-examples build`. */
import { mkdirSync, writeFileSync } from "node:fs";
import { render } from "mbingpdf";
import { certificate } from "./certificate.ts";
import { invoice } from "./invoice.ts";
import { labelSheet } from "./label-sheet.ts";
import { letter } from "./letter.ts";
import { report } from "./report.ts";

const out = new URL("./out/", import.meta.url);
mkdirSync(out, { recursive: true });
const documents = {
  invoice: invoice(),
  report: report(),
  letter: letter(),
  certificate: certificate(),
  "certificate-print": certificate(undefined, { bleed: true }),
  "label-sheet": labelSheet(undefined, { outlines: true }),
};
for (const [name, document] of Object.entries(documents)) {
  const started = performance.now();
  const pdf = await render(document, {
    onWarning: (warning) => console.warn(`${name}: ${warning.message}`),
  });
  writeFileSync(new URL(`${name}.pdf`, out), pdf);
  console.log(
    `${name}.pdf  ${(pdf.length / 1024).toFixed(1)} kB  ${Math.round(performance.now() - started)} ms`,
  );
}
