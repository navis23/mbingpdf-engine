// The picture shown when the site is shared: 1200 × 630, made by the library like the rest.
const ink = "#14110F";
const paper = "#F4F0E6";
const spot = "#2238FF";
const inks = ["#00AEEF", "#EC008C", "#FFEC00", ink, "#8FD6F6", "#F58FC8", "#FFF58F", "#8A8782", "#ED1C24", "#00A651", "#2E3192", "#C8C4BC"];

return Document(
  { title: "mbingpdf", font: fonts.jakarta, color: ink },
  Page(
    { size: [1200, 630], margin: 0, fill: paper },
    Row({ height: 14 }, inks.map((color) => Box({ grow: 1, basis: 0, height: 14, background: color }))),
    Stack(
      { padding: [54, 72, 0, 72], gap: 0 },
      Row(
        { gap: 14, align: "center" },
        Canvas({
          width: 44,
          height: 44,
          decorative: true,
          draw: (g) => {
            g.moveTo(12, 12).lineTo(26, 12).lineTo(32, 18).lineTo(32, 32).lineTo(12, 32).closePath().fill(spot);
            for (const [x1, y1, x2, y2] of [[2, 12, 8, 12], [12, 2, 12, 8], [36, 12, 42, 12], [32, 2, 32, 8], [2, 32, 8, 32], [12, 36, 12, 42], [36, 32, 42, 32], [32, 36, 32, 42]]) {
              g.line(x1, y1, x2, y2);
            }
            g.stroke({ color: ink, width: 2.2 });
          },
        }),
        Text({ font: fonts.barlow, size: 40 }, "mbing", Span({ color: spot }, "pdf")),
      ),
      Spacer(40),
      Text({ font: fonts.barlow, size: 146, lineHeight: 0.86, transform: "uppercase" }, "Documents,\ntypeset in code", Span({ color: spot }, ".")),
      Spacer(44),
      Row(
        { justify: "space-between", align: "end" },
        Text({ size: 27, color: "#3D3933", width: 640, lineHeight: 1.35 }, "A TypeScript PDF engine for browsers and servers. No dependencies."),
        Text({ font: fonts.mono, size: 22 }, "npm install mbingpdf"),
      ),
    ),
  ),
);
