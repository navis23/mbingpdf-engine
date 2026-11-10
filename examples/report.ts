/**
 * Starter template: a report.
 *
 * A cover, a table of contents built from the headings, chapters that flow over as many pages
 * as they need, a chart drawn on a canvas, and running headers and footers.
 */
import {
  Canvas,
  Document,
  Heading,
  hyphenateIndonesian,
  List,
  mm,
  Page,
  PageBreak,
  Row,
  Spacer,
  StandardFonts,
  Table,
  TableOfContents,
  Text,
} from "mbingpdf";

export interface ReportData {
  title: string;
  subtitle: string;
  organisation: string;
  chapters: { title: string; paragraphs: string[]; points?: string[] }[];
  figures: { label: string; value: number }[];
}

const paragraph =
  "Sepanjang tahun ini kegiatan berjalan sesuai rencana kerja yang disusun pada awal periode. " +
  "Pencapaian utama diuraikan pada bagian ini beserta kendala yang ditemui dan langkah perbaikan yang diambil. ";

export const sampleReport: ReportData = {
  title: "Laporan Tahunan 2026",
  subtitle: "Ringkasan kegiatan dan keuangan",
  organisation: "Yayasan Contoh",
  chapters: [
    { title: "Pendahuluan", paragraphs: [paragraph.repeat(3), paragraph.repeat(2)] },
    {
      title: "Kegiatan",
      paragraphs: [paragraph.repeat(4)],
      points: ["Pelatihan bagi 240 peserta", "Dua belas kunjungan lapangan", "Tiga terbitan baru"],
    },
    { title: "Keuangan", paragraphs: [paragraph.repeat(3)] },
    { title: "Rencana tahun depan", paragraphs: [paragraph.repeat(5), paragraph.repeat(3)] },
  ],
  figures: [
    { label: "Tw 1", value: 420 },
    { label: "Tw 2", value: 510 },
    { label: "Tw 3", value: 480 },
    { label: "Tw 4", value: 640 },
  ],
};

export function report(data: ReportData = sampleReport) {
  const bold = StandardFonts.TimesBold;
  const max = Math.max(...data.figures.map((figure) => figure.value));
  return Document(
    {
      title: data.title,
      author: data.organisation,
      lang: "id",
      font: StandardFonts.TimesRoman,
      size: 11,
      lineHeight: 1.4,
    },
    // The cover: no header or footer.
    Page(
      { size: "A4", margin: mm(30) },
      Spacer(mm(70)),
      Text({ font: bold, size: 34, lineHeight: 1.1 }, data.title),
      Text({ size: 16, color: "#4B5563", margin: { top: 8 } }, data.subtitle),
      Spacer(mm(90)),
      Text({ font: bold }, data.organisation),
    ),
    Page(
      {
        size: "A4",
        margin: mm(25),
        gap: 10,
        header: Row(
          {
            border: { bottom: { width: 0.5, color: "#9CA3AF" } },
            padding: [0, 0, 4, 0],
            size: 9,
            color: "#6B7280",
          },
          Text(data.title),
          Spacer(),
          Text(data.organisation),
        ),
        footer: ({ page }) =>
          Text({ size: 9, align: "center", color: "#6B7280", padding: [6, 0, 0, 0] }, String(page)),
      },
      Heading({ level: 1, font: bold, bookmark: false }, "Daftar Isi"),
      TableOfContents({ levels: [1, 2] }),
      PageBreak(),
      data.chapters.map((chapter, index) => [
        Heading(
          { level: 1, font: bold, break: index === 0 ? undefined : "before" },
          `${index + 1}. ${chapter.title}`,
        ),
        chapter.paragraphs.map((text) =>
          Text({ align: "justify", hyphenate: hyphenateIndonesian }, text),
        ),
        chapter.points && List({ marker: "disc", gap: 3 }, chapter.points),
        chapter.title === "Keuangan" && [
          Heading({ level: 2, font: bold }, "Pendapatan per triwulan"),
          Canvas({
            width: "100%",
            height: 140,
            draw: (g, { width, height }) => {
              const slot = width / data.figures.length;
              g.line(0, height - 0.5, width, height - 0.5).stroke({ color: "#6B7280" });
              data.figures.forEach((figure, i) => {
                const bar = ((height - 20) * figure.value) / max;
                g.rect(i * slot + slot * 0.2, height - bar, slot * 0.6, bar).fill("#1D4ED8");
              });
            },
          }),
          Table({
            columns: [{ width: "1fr" }, { width: 120, align: "end" }],
            header: ["Triwulan", "Pendapatan (juta Rp)"],
            rows: data.figures.map((figure) => [figure.label, figure.value]),
            headerStyle: { font: bold },
          }),
        ],
      ]),
    ),
  );
}
