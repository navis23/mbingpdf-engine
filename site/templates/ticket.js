// A ticket on its own paper size, with a dashed line to tear along.
const ink = "#14110F";
const muted = "#6B665E";
const accent = "#2238FF";
const paper = "#FBF8F1";
const bold = fonts.jakarta.instance({ wght: 700 });
const medium = fonts.jakarta.instance({ wght: 500 });

const field = (caption, value) =>
  Stack(
    { gap: 1, grow: 1, basis: 0 },
    Text({ font: medium, size: 6.5, color: muted, letterSpacing: 0.8, transform: "uppercase" }, caption),
    Text({ font: bold, size: 11 }, value),
  );

return Document(
  { title: "Ticket BHM-0421", lang: "en", font: fonts.jakarta, size: 9, color: ink },
  Page(
    { size: [mm(90), mm(190)], margin: 0, fill: paper },
    Stack(
      { background: accent, color: "#FFFFFF", padding: [mm(8), mm(7)], gap: 4 },
      Text({ font: fonts.mono, size: 7, letterSpacing: 1.5 }, "RACE TICKET · ADMIT ONE"),
      Text({ font: fonts.barlow, size: 40, lineHeight: 0.9 }, "BANDUNG HALF MARATHON"),
    ),
    Stack(
      { padding: mm(7), gap: 12 },
      Row({ gap: 10 }, field("Runner", "Kirana Dewi"), field("Bib", "0421")),
      Row({ gap: 10 }, field("Distance", "21.1 km"), field("Wave", "B · 05:15")),
      Row({ gap: 10 }, field("Date", "Sun 9 Nov 2026"), field("Start", "Gedung Sate")),
    ),
    Spacer(),
    // The stub below the line stays with the organiser.
    Stack(
      { border: { top: { width: 0.75, color: ink, dash: [3, 3] } }, padding: mm(7), gap: 8, align: "center" },
      QrCode({ value: "https://example.com/t/BHM-0421-X7K2", size: mm(42), quiet: 0 }),
      Text({ font: fonts.mono, size: 8, letterSpacing: 1 }, "BHM-0421-X7K2"),
      Text({ size: 7.5, color: muted, align: "center" }, "Show this code at race-pack collection.\nBring a photo ID."),
    ),
  ),
);
