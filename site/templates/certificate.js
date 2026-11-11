// A certificate prepared for a print shop: 3 mm of bleed, crop and registration marks.
// The preview shows the finished page; download the PDF to see the press sheet.
const ink = "#14110F";
const muted = "#6B665E";
const accent = "#2238FF";
const bold = fonts.jakarta.instance({ wght: 700 });
const medium = fonts.jakarta.instance({ wght: 500 });
const bleed = mm(3);

const recipient = "Bartholomew Maximilian Wolfeschlegelstein";
const stat = (value, caption) =>
  Stack(
    { gap: 1 },
    Text({ font: fonts.barlow, size: 30, lineHeight: 0.95 }, value),
    Text({ font: medium, size: 7, color: muted, letterSpacing: 0.9, transform: "uppercase" }, caption),
  );

return Document(
  { title: `Certificate: ${recipient}`, lang: "en", font: fonts.jakarta, size: 11, color: ink },
  Page(
    {
      size: "A4",
      orientation: "landscape",
      margin: [mm(20), mm(22), mm(20), mm(40)],
      bleed,
      marks: true,
      fill: "#FBF8F1",
      justify: "center",
      gap: 12,
      // The background covers the bleed, so colour runs past the trim line and no white
      // edge shows if the cut is a fraction off.
      background: Canvas({
        width: "100%",
        height: mm(210) + bleed * 2,
        decorative: true,
        draw: (g, { width, height }) => {
          g.rect(0, 0, bleed + mm(16), height).fill(accent);
          for (let ring = 0; ring < 11; ring++) {
            g.circle(width - bleed - mm(6), height - bleed + mm(4), mm(16) + ring * mm(8));
          }
          g.stroke({ color: "#E6E0D2", width: 0.7 });
        },
      }),
    },
    Text(
      { font: fonts.mono, size: 8.5, color: accent, letterSpacing: 2.4, transform: "uppercase" },
      "Certificate of completion",
    ),
    // One line, whatever the length of the name: the text is sized to the width.
    Text({ font: fonts.barlow, size: 84, fit: { min: 24, max: 84 }, lineHeight: 0.95 }, recipient),
    Text(
      { size: 13, color: muted, width: mm(150) },
      "finished the Bandung Half Marathon on 9 November 2026, 21.1 km through the city and up to Dago.",
    ),
    Spacer(8),
    Row({ gap: 34 }, stat("1:48:26", "Finish time"), stat("212 / 3,840", "Overall"), stat("5:08 /km", "Average pace")),
    Spacer(14),
    Row(
      { justify: "space-between", align: "end" },
      Stack(
        { gap: 2, width: mm(64), border: { top: { width: 0.75, color: ink } }, padding: [6, 0, 0, 0] },
        Text({ font: bold }, "Dr. Siti Rahmawati"),
        Text({ size: 9, color: muted }, "Race director"),
      ),
      Row(
        { gap: 10, align: "center" },
        Stack(
          { align: "end", gap: 1 },
          Text({ font: medium, size: 7, color: muted, letterSpacing: 0.9, transform: "uppercase" }, "Verify"),
          Text({ font: fonts.mono, size: 8 }, "BHM-2026-0412"),
        ),
        QrCode({ value: "https://example.com/verify/BHM-2026-0412", size: 46, quiet: 0 }),
      ),
    ),
  ),
);
