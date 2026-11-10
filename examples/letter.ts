/**
 * Starter template: a business letter.
 *
 * A letterhead that repeats on every page, the addressee, the body, and a closing block that is
 * never separated from its signature line.
 */
import { Document, mm, Page, Row, Spacer, Stack, StandardFonts, Text } from "mbingpdf";

export interface LetterData {
  sender: { name: string; address: string; contact: string };
  recipient: { name: string; address: string };
  place: string;
  date: string;
  reference: string;
  subject: string;
  salutation: string;
  paragraphs: string[];
  closing: string;
  signatory: { name: string; role: string };
}

export const sampleLetter: LetterData = {
  sender: {
    name: "PT Contoh Sejahtera",
    address: "Jl. Merdeka No. 17, Bandung 40111",
    contact: "halo@contoh.id · (022) 555 0100",
  },
  recipient: {
    name: "Ibu Sari Wulandari",
    address: "Yayasan Pendidikan Nusantara\nJl. Asia Afrika No. 8\nBandung 40112",
  },
  place: "Bandung",
  date: "10 November 2026",
  reference: "012/PCS/XI/2026",
  subject: "Penawaran kerja sama",
  salutation: "Dengan hormat,",
  paragraphs: [
    "Sehubungan dengan rencana kegiatan studi wisata yang akan diselenggarakan pada bulan Desember, bersama surat ini kami menyampaikan penawaran layanan transportasi dan akomodasi bagi rombongan Ibu.",
    "Rincian layanan, jadwal dan biaya kami lampirkan bersama surat ini. Penawaran berlaku selama tiga puluh hari sejak tanggal surat.",
    "Kami berharap dapat bekerja sama dan bersedia menjelaskan lebih lanjut bila diperlukan.",
  ],
  closing: "Hormat kami,",
  signatory: { name: "Budi Santoso", role: "Direktur" },
};

export function letter(data: LetterData = sampleLetter) {
  const bold = StandardFonts.HelveticaBold;
  return Document(
    { title: data.subject, author: data.sender.name, lang: "id", size: 10.5, lineHeight: 1.5 },
    Page(
      {
        size: "A4",
        margin: [mm(20), mm(25), mm(20), mm(25)],
        gap: 12,
        header: Stack(
          {
            border: { bottom: { width: 1.5, color: "#1D4ED8" } },
            padding: [0, 0, 8, 0],
            margin: { bottom: 14 },
            lineHeight: 1.25,
          },
          Text({ font: bold, size: 15, color: "#1D4ED8" }, data.sender.name),
          Text({ size: 8.5, color: "#6B7280" }, `${data.sender.address} · ${data.sender.contact}`),
        ),
        footer: ({ page, pages }) =>
          pages > 1
            ? Text({ size: 8.5, align: "right", color: "#6B7280" }, `${page} / ${pages}`)
            : null,
      },
      Row(
        Stack(Text(`Nomor: ${data.reference}`), Text("Perihal: ", data.subject)),
        Spacer(),
        Text(`${data.place}, ${data.date}`),
      ),
      Stack(
        { margin: { top: 6 } },
        Text("Kepada Yth."),
        Text({ font: bold }, data.recipient.name),
        Text(data.recipient.address),
      ),
      Text({ margin: { top: 6 } }, data.salutation),
      data.paragraphs.map((text) => Text({ align: "justify" }, text)),
      // The closing never ends up alone at the top of a new page without its signature.
      Stack(
        { keepTogether: true, margin: { top: 10 } },
        Text(data.closing),
        Spacer(mm(22)),
        Text({ font: bold }, data.signatory.name),
        Text(data.signatory.role),
      ),
    ),
  );
}
