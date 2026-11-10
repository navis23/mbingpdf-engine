/**
 * Starter template: an invoice.
 *
 * A letterhead, the customer's details, a table of line items with totals, and a footer with
 * the page number. Uses the fonts built into every PDF viewer, so it needs no font files.
 */
import {
  Cell,
  Document,
  defineTheme,
  mm,
  Page,
  Row,
  Spacer,
  Stack,
  StandardFonts,
  Table,
  Text,
} from "mbingpdf";

export interface InvoiceData {
  number: string;
  date: string;
  due: string;
  seller: { name: string; address: string; taxId?: string };
  customer: { name: string; address: string };
  /** Tax as a fraction of the subtotal, such as 0.11 for 11%. */
  taxRate: number;
  items: { description: string; quantity: number; unitPrice: number }[];
  notes?: string;
}

export const sampleInvoice: InvoiceData = {
  number: "INV-2026-0042",
  date: "10 November 2026",
  due: "24 November 2026",
  seller: {
    name: "PT Contoh Sejahtera",
    address: "Jl. Merdeka No. 17\nBandung 40111",
    taxId: "01.234.567.8-901.000",
  },
  customer: {
    name: "Yayasan Pendidikan Nusantara",
    address: "Jl. Asia Afrika No. 8\nBandung 40112",
  },
  taxRate: 0.11,
  items: [
    { description: "Sewa bus pariwisata, 3 hari", quantity: 1, unitPrice: 3_500_000 },
    { description: "Tiket masuk rombongan", quantity: 30, unitPrice: 25_000 },
    { description: "Makan siang", quantity: 30, unitPrice: 20_000 },
  ],
  notes: "Pembayaran melalui transfer bank ke rekening yang tertera pada surat penawaran.",
};

const theme = defineTheme({
  fonts: {
    body: {
      sources: {
        400: StandardFonts.Helvetica,
        700: StandardFonts.HelveticaBold,
        "400i": StandardFonts.HelveticaOblique,
      },
    },
  },
  colors: {
    text: "#111827",
    muted: "#6B7280",
    line: "#E5E7EB",
    brand: "#1D4ED8",
    panel: "#F3F4F6",
  },
  text: {
    body: { font: "body", size: 10, leading: 14, color: "text" },
    title: { font: "body", weight: 700, size: 24, leading: 28, color: "brand" },
    label: { font: "body", size: 8, leading: 11, color: "muted" },
    strong: { font: "body", weight: 700, size: 10, leading: 14 },
  },
});

const money = (value: number): string =>
  `Rp ${Math.round(value).toLocaleString("en-US").replace(/,/g, ".")}`;

export function invoice(data: InvoiceData = sampleInvoice) {
  const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const tax = subtotal * data.taxRate;
  const party = (label: string, name: string, address: string) =>
    Stack(
      { gap: 2 },
      Text({ style: "label" }, label),
      Text({ style: "strong" }, name),
      Text(address),
    );

  return Document(
    { title: `Invoice ${data.number}`, author: data.seller.name, theme },
    Page(
      {
        size: "A4",
        margin: mm(18),
        gap: 20,
        footer: ({ page, pages }) =>
          Text(
            { style: "label", align: "center" },
            `${data.number} · Halaman ${page} dari ${pages}`,
          ),
      },
      Row(
        { align: "start" },
        Stack(
          { gap: 2 },
          Text({ style: "strong", size: 13 }, data.seller.name),
          Text({ color: "muted" }, data.seller.address),
        ),
        Spacer(),
        Stack(
          { align: "end", gap: 2 },
          Text({ style: "title" }, "INVOICE"),
          Text({ color: "muted" }, data.number),
        ),
      ),
      Row(
        { gap: 24 },
        Stack({ grow: 1 }, party("DITAGIHKAN KEPADA", data.customer.name, data.customer.address)),
        Stack(
          { gap: 8 },
          Stack({ gap: 2 }, Text({ style: "label" }, "TANGGAL"), Text(data.date)),
          Stack({ gap: 2 }, Text({ style: "label" }, "JATUH TEMPO"), Text(data.due)),
        ),
      ),
      Table({
        columns: [
          { width: "1fr" },
          { width: 50, align: "end" },
          { width: 95, align: "end" },
          { width: 100, align: "end" },
        ],
        header: ["Uraian", "Jml", "Harga satuan", "Jumlah"],
        rows: data.items.map((item) => [
          item.description,
          item.quantity,
          money(item.unitPrice),
          money(item.quantity * item.unitPrice),
        ]),
        footer: [
          [Cell({ colSpan: 3, align: "end" }, "Subtotal"), money(subtotal)],
          [
            Cell({ colSpan: 3, align: "end" }, `PPN ${Math.round(data.taxRate * 100)}%`),
            money(tax),
          ],
          [
            Cell({ colSpan: 3, align: "end", weight: 700 }, "Total"),
            Cell({ weight: 700 }, money(subtotal + tax)),
          ],
        ],
        headerStyle: { weight: 700, size: 9, background: "panel" },
        cellPadding: [6, 8],
        borders: { horizontal: { width: 0.5, color: "line" } },
      }),
      data.notes && Stack({ gap: 2 }, Text({ style: "label" }, "CATATAN"), Text(data.notes)),
      data.seller.taxId && Text({ style: "label" }, `NPWP ${data.seller.taxId}`),
    ),
  );
}
