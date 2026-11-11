// A sheet of race-pack labels, 3 across and 8 down, positioned to the millimetre.
// Forty labels flow onto a second sheet by themselves.
const ink = "#14110F";
const muted = "#6B665E";
const bold = fonts.jakarta.instance({ wght: 700 });

const runners = Array.from({ length: 40 }, (_runner, i) => ({
  number: String(401 + i).padStart(4, "0"),
  name: ["Kirana Dewi", "Bagus Pratama", "Sekar Ayu Lestari", "Rizky Maulana", "Dimas Aryo Wicaksono"][i % 5],
  category: i % 3 === 0 ? "10K" : "21K",
  size: ["S", "M", "L", "XL"][i % 4],
}));
const cut = { width: 0.5, color: "#B9B3A6", dash: [2, 2] };

return Document(
  { title: "Race-pack labels", lang: "en", font: fonts.jakarta, size: 8, color: ink },
  Page(
    { size: "A4", margin: [mm(0.5), 0] },
    Grid(
      { columns: 3, rows: 8, cell: { width: mm(70), height: mm(37) } },
      runners.map((runner, i) =>
        Row(
          {
            height: mm(37),
            padding: mm(4),
            gap: mm(3),
            align: "center",
            // Dashed lines to cut along, only between labels.
            border: { bottom: cut, ...(i % 3 < 2 ? { right: cut } : {}) },
          },
          Stack(
            { grow: 1, basis: 0, gap: 2 },
            Text({ font: fonts.barlow, size: 30, lineHeight: 0.9 }, runner.number),
            Text({ font: bold, size: 9, truncate: true }, runner.name),
            Text({ color: muted }, `${runner.category} · Shirt ${runner.size}`),
          ),
          Barcode({ value: `BHM-${runner.number}`, barHeight: 34, moduleWidth: 0.8, textSize: 6, quiet: 0 }),
        ),
      ),
    ),
  ),
);
