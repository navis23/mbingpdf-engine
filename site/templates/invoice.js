// An invoice. Edit anything: the preview on the right is the PDF's own layout.
const ink = "#14110F";
const muted = "#6B665E";
const rule = "#D9D4C7";
const accent = "#2238FF";
const bold = fonts.jakarta.instance({ wght: 700 });
const medium = fonts.jakarta.instance({ wght: 500 });

const items = [
  ["Bus charter, Bandung to Yogyakarta", 2, 4_250_000],
  ["Driver and crew, three days", 3, 650_000],
  ["Toll, fuel and parking", 1, 1_180_000],
  ["Travel insurance, per passenger", 42, 15_000],
];
const rupiah = (value) => `Rp ${value.toLocaleString("id-ID")}`;
const subtotal = items.reduce((sum, [, quantity, price]) => sum + quantity * price, 0);
const tax = Math.round(subtotal * 0.11);

const label = (text) =>
  Text({ font: medium, size: 7, color: muted, letterSpacing: 0.9, transform: "uppercase" }, text);
const sun =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="7" fill="currentColor"/>' +
  '<path d="M16 2v5M16 25v5M2 16h5M25 16h5M6 6l3.5 3.5M22.5 22.5 26 26M6 26l3.5-3.5M22.5 9.5 26 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';

return Document(
  { title: "Invoice INV-2026-0412", lang: "en", font: fonts.jakarta, size: 9.5, color: ink },
  Page(
    {
      size: "A4",
      margin: mm(18),
      gap: 24,
      footer: ({ page, pages }) =>
        Row(
          { justify: "space-between" },
          Text({ size: 7.5, color: muted }, "Sinar Rental · Jl. Braga No. 17, Bandung 40111"),
          Text({ size: 7.5, color: muted }, `Page ${page} of ${pages}`),
        ),
    },
    Row(
      { justify: "space-between", align: "start" },
      Row(
        { gap: 8, align: "center" },
        Svg({ src: sun, width: 26, color: accent, alt: "Sinar Rental" }),
        Text({ font: bold, size: 13 }, "Sinar Rental"),
      ),
      Stack(
        { align: "end", gap: 1 },
        Text({ font: fonts.barlow, size: 44, lineHeight: 0.9 }, "INVOICE"),
        Text({ font: fonts.mono, size: 8.5, color: muted }, "INV-2026-0412"),
      ),
    ),
    Row(
      { gap: 28 },
      Stack(
        { grow: 1, basis: 0, gap: 3 },
        label("Billed to"),
        Text({ font: bold, size: 11 }, "Yayasan Lentera Nusantara"),
        Text({ color: muted }, "Jl. Dago Atas No. 88\nBandung 40135"),
      ),
      Stack({ gap: 3 }, label("Issued"), Text("12 November 2026")),
      Stack({ gap: 3 }, label("Due"), Text({ font: bold, color: accent }, "26 November 2026")),
    ),
    Table({
      columns: [
        { width: "1fr" },
        { width: 40, align: "end" },
        { width: 88, align: "end" },
        { width: 96, align: "end" },
      ],
      header: ["Description", "Qty", "Unit price", "Amount"],
      rows: items.map(([name, quantity, price]) => [
        name,
        quantity,
        rupiah(price),
        rupiah(quantity * price),
      ]),
      headerStyle: { font: medium, size: 7, color: muted },
      cellPadding: [8, 0],
      borders: { horizontal: { width: 0.5, color: rule }, header: { width: 1, color: ink } },
    }),
    Row(
      { justify: "end" },
      Stack(
        { width: 232, gap: 7 },
        Row({ justify: "space-between" }, Text({ color: muted }, "Subtotal"), Text(rupiah(subtotal))),
        Row({ justify: "space-between" }, Text({ color: muted }, "VAT 11%"), Text(rupiah(tax))),
        Box(
          { border: { top: { width: 1, color: ink } }, padding: [9, 0, 0, 0] },
          Row(
            { justify: "space-between", align: "end" },
            Text({ font: bold }, "Total due"),
            Text({ font: fonts.barlow, size: 24, lineHeight: 0.9 }, rupiah(subtotal + tax)),
          ),
        ),
      ),
    ),
    Spacer(),
    Row(
      { gap: 14, align: "center" },
      QrCode({ value: "https://example.com/pay/INV-2026-0412", size: 60, quiet: 0 }),
      Stack(
        { gap: 3 },
        label("Pay by transfer, or scan"),
        Text({ font: bold }, "Bank Mandiri 131-00-1234567-8"),
        Text({ color: muted }, "Please quote the invoice number."),
      ),
    ),
  ),
);
