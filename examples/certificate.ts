/**
 * Starter template: a certificate.
 *
 * A landscape page with a frame drawn across the whole sheet, a name that shrinks to fit one
 * line however long it is, and a QR code to verify it. Pass `bleed: true` for a version with
 * bleed and crop marks, ready for a print shop.
 */
import {
  Canvas,
  Document,
  mm,
  Page,
  QrCode,
  Row,
  Spacer,
  Stack,
  StandardFonts,
  Text,
} from "mbingpdf";

export interface CertificateData {
  heading: string;
  recipient: string;
  reason: string;
  achievement: string;
  date: string;
  signatory: { name: string; role: string };
  verifyUrl: string;
  colour?: `#${string}`;
}

export const sampleCertificate: CertificateData = {
  heading: "Sertifikat Penghargaan",
  recipient: "Bartholomew Maximilian Wolfeschlegelstein",
  reason: "atas partisipasi dan pencapaiannya dalam",
  achievement: "Pelatihan Kepemimpinan Angkatan XII",
  date: "Bandung, 10 November 2026",
  signatory: { name: "Dr. Siti Rahma", role: "Ketua Panitia" },
  verifyUrl: "https://contoh.id/sertifikat/2026-0412",
};

export function certificate(
  data: CertificateData = sampleCertificate,
  options: { bleed?: boolean } = {},
) {
  const colour = data.colour ?? "#1E3A8A";
  const bleed = options.bleed ? mm(3) : 0;
  return Document(
    {
      title: `${data.heading} — ${data.recipient}`,
      font: StandardFonts.TimesRoman,
      size: 13,
      color: "#1F2937",
    },
    Page(
      {
        size: "A4",
        orientation: "landscape",
        margin: mm(24),
        gap: 8,
        ...(options.bleed ? { bleed, marks: true } : {}),
        fill: "#FFFDF7",
        // The background is laid out across the bleed, so the frame is inset from its edge.
        background: Canvas({
          width: "100%",
          height: mm(210) + bleed * 2,
          draw: (g, { width, height }) => {
            const inset = bleed + mm(9);
            g.rect(0, 0, width, bleed + mm(5)).fill(colour);
            g.rect(0, height - bleed - mm(5), width, bleed + mm(5)).fill(colour);
            g.rect(inset, inset, width - inset * 2, height - inset * 2).stroke({
              color: colour,
              width: 1.2,
            });
            g.rect(inset + 4, inset + 4, width - (inset + 4) * 2, height - (inset + 4) * 2).stroke({
              color: colour,
              width: 0.4,
            });
          },
        }),
      },
      Spacer(mm(10)),
      Text(
        {
          font: StandardFonts.TimesBold,
          size: 30,
          align: "center",
          color: colour,
          letterSpacing: 3,
          transform: "uppercase",
        },
        data.heading,
      ),
      Spacer(mm(8)),
      Text({ align: "center", color: "#6B7280" }, "diberikan kepada"),
      // One line, whatever the length of the name.
      Text(
        {
          font: StandardFonts.TimesBoldItalic,
          size: 44,
          fit: { min: 16, max: 44 },
          align: "center",
        },
        data.recipient,
      ),
      Text({ align: "center" }, data.reason),
      Text(
        { font: StandardFonts.TimesBold, size: 20, align: "center", color: colour },
        data.achievement,
      ),
      Spacer(mm(14)),
      Row(
        { align: "end" },
        Stack(
          { gap: 2 },
          Text({ size: 10, color: "#6B7280" }, data.date),
          Spacer(mm(14)),
          Text({ font: StandardFonts.TimesBold }, data.signatory.name),
          Text({ size: 10 }, data.signatory.role),
        ),
        Spacer(),
        Stack(
          { align: "center", gap: 3 },
          QrCode({ value: data.verifyUrl, size: mm(24), quiet: 2 }),
          Text({ size: 7, color: "#6B7280" }, "Pindai untuk memeriksa keaslian"),
        ),
      ),
    ),
  );
}
