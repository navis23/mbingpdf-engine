/**
 * Starter template: a sheet of labels.
 *
 * Three columns of eight labels on A4, each 70 × 37 mm, positioned to the millimetre: the
 * layout of common self-adhesive sheets. Any number of labels flows onto further sheets.
 */
import { Document, Grid, mm, Page, QrCode, Row, Stack, StandardFonts, Text } from "mbingpdf";

export interface LabelData {
  title: string;
  lines: string[];
  code: string;
}

export const sampleLabels: LabelData[] = Array.from({ length: 40 }, (_value, i) => ({
  title: `Peserta ${String(i + 1).padStart(3, "0")}`,
  lines: ["Half Marathon 21K", `Gelombang ${String.fromCharCode(65 + (i % 4))}`],
  code: `https://contoh.id/tas/${1000 + i}`,
}));

export function labelSheet(
  labels: LabelData[] = sampleLabels,
  options: { outlines?: boolean } = {},
) {
  return Document(
    { title: "Label", size: 9 },
    // 3 × 70 mm is exactly the width of A4; 8 × 37 mm leaves 0.5 mm above and below.
    Page(
      { size: "A4", margin: [mm(0.5), 0] },
      Grid(
        { columns: 3, rows: 8, cell: { width: mm(70), height: mm(37) } },
        labels.map((label) =>
          Row(
            {
              height: mm(37),
              padding: mm(4),
              gap: mm(3),
              align: "center",
              // Outlines help when checking alignment on plain paper; leave them off for label stock.
              ...(options.outlines ? { border: { width: 0.25, color: "#9CA3AF" } } : {}),
            },
            QrCode({ value: label.code, size: mm(22), quiet: 1 }),
            Stack(
              { grow: 1, gap: 2 },
              Text({ font: StandardFonts.HelveticaBold, size: 13, fit: true }, label.title),
              label.lines.map((line) => Text({ color: "#374151" }, line)),
            ),
          ),
        ),
      ),
    ),
  );
}

/** For `mbingpdf dev examples/label-sheet.ts`: the template with its sample data. */
export default labelSheet;
