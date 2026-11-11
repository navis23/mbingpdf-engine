// A race bib. The number fills the width whatever its length: try "7" or "12048".
const ink = "#14110F";
const accent = "#2238FF";
const bold = fonts.jakarta.instance({ wght: 700 });
const medium = fonts.jakarta.instance({ wght: 500 });

const runner = { number: "0421", name: "Kirana Dewi Anggraini", category: "21K", wave: "B", blood: "O+" };

return Document(
  { title: `Bib ${runner.number}`, lang: "en", font: fonts.jakarta, size: 10, color: ink },
  Page(
    { size: "A5", orientation: "landscape", margin: 0 },
    Row(
      { background: ink, color: "#FBF8F1", padding: [mm(5), mm(8)], justify: "space-between", align: "center" },
      Text({ font: fonts.barlow, size: 20, letterSpacing: 1 }, "BANDUNG HALF MARATHON"),
      Text({ font: fonts.mono, size: 9, letterSpacing: 1 }, "9 NOV 2026"),
    ),
    Spacer(),
    Text(
      { font: fonts.barlow, size: 260, fit: { max: 290 }, align: "center", lineHeight: 0.82, padding: [0, mm(10)] },
      runner.number,
    ),
    Spacer(),
    Row(
      { padding: [0, mm(8), mm(6), mm(8)], gap: mm(6), align: "end" },
      Stack(
        { grow: 1, basis: 0, gap: 2 },
        // A long name is cut short with an ellipsis instead of wrapping or overflowing.
        Text({ font: bold, size: 18, truncate: true, transform: "uppercase" }, runner.name),
        Row(
          { gap: 6 },
          Box({ background: accent, color: "#FFFFFF", padding: [2, 7], radius: 2 }, Text({ font: bold, size: 9 }, runner.category)),
          Box({ border: { width: 0.75, color: ink }, padding: [1.25, 7], radius: 2 }, Text({ font: medium, size: 9 }, `Wave ${runner.wave}`)),
          Box({ border: { width: 0.75, color: ink }, padding: [1.25, 7], radius: 2 }, Text({ font: medium, size: 9 }, runner.blood)),
        ),
      ),
      Barcode({ value: `BHM-${runner.number}`, barHeight: 30, textSize: 7, quiet: 0 }),
      QrCode({ value: `https://example.com/live/${runner.number}`, size: 52, quiet: 0 }),
    ),
  ),
);
