const bold = fonts.jakarta.instance({ wght: 700 });

return Document(
  { title: "Receipt", font: fonts.jakarta, size: 10 },
  Page(
    { size: [mm(80), mm(96)], margin: mm(8), gap: 12 },
    Text({ font: fonts.barlow, size: 36 }, "THANK YOU"),
    Table({
      columns: ["1fr", { width: 70, align: "end" }],
      rows: [
        ["Kopi susu, iced", "Rp 22.000"],
        ["Pisang goreng", "Rp 15.000"],
      ],
      footer: [[Text({ font: bold }, "Total"), Text({ font: bold }, "Rp 37.000")]],
    }),
    Spacer(),
    Row(
      { gap: 10, align: "center" },
      QrCode({ value: "https://example.com/r/8841", size: 48 }),
      Text({ color: "#6B665E" }, "Scan for your receipt.\nSee you again."),
    ),
  ),
);
