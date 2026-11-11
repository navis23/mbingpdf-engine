// A report: columns of justified, hyphenated text, charts, and a table.
const ink = "#14110F";
const muted = "#6B665E";
const rule = "#D9D4C7";
const accent = "#2238FF";
const bold = fonts.jakarta.instance({ wght: 700 });
const medium = fonts.jakarta.instance({ wght: 500 });

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
const lastYear = [212, 198, 240, 251, 286, 322, 348, 331, 290];
const thisYear = [248, 236, 301, 334, 392, 441, 486, 468, 421];
const fleet = [
  ["Bus, 45 seats", 18, 1_942, "71%"],
  ["Minibus, 16 seats", 24, 1_105, "64%"],
  ["Van, 7 seats", 31, 280, "58%"],
];
const paragraph = (text) => Text({ align: "justify", hyphenate: hyphenateEnglish }, text);

return Document(
  { title: "Third quarter report", lang: "en", font: fonts.jakarta, size: 9.5, lineHeight: 1.5, color: ink },
  Page(
    {
      size: "A4",
      margin: [mm(20), mm(18)],
      gap: 16,
      header: Row(
        { justify: "space-between", padding: [0, 0, 10, 0] },
        Text({ font: fonts.mono, size: 7, color: muted, letterSpacing: 1 }, "SINAR RENTAL"),
        Text({ font: fonts.mono, size: 7, color: muted, letterSpacing: 1 }, "Q3 2026"),
      ),
      footer: ({ page, pages }) =>
        Text({ align: "center", size: 7.5, color: muted }, `${page} / ${pages}`),
    },
    Text(
      { font: fonts.barlow, size: 46, lineHeight: 0.95 },
      "Bookings grew 38% in the third quarter",
    ),
    Columns(
      { count: 2, gap: 20 },
      paragraph(
        "School trips returned in July and carried the quarter. Weekday charters, which had been the quiet part of the calendar, now fill four days in five, and the average booking is made eleven days earlier than a year ago.",
      ),
      paragraph(
        "The new minibuses arrived in August. They were booked within a week of being listed, mostly by companies moving staff between Bandung and the industrial estates to the east, a route no larger vehicle serves economically.",
      ),
    ),
    Row(
      { gap: 18 },
      BarChart({
        grow: 1,
        basis: 0,
        height: 176,
        title: "Bookings per month",
        labels: months,
        series: [
          { name: "2025", values: lastYear },
          { name: "2026", values: thisYear },
        ],
        colors: ["#C9C3B5", accent],
      }),
      LineChart({
        grow: 1,
        basis: 0,
        height: 176,
        title: "Revenue, Rp million",
        labels: months,
        values: thisYear.map((count) => Math.round(count * 4.2)),
        area: true,
        smooth: true,
        points: false,
        colors: [accent],
      }),
    ),
    Heading({ level: 2, font: fonts.barlow, size: 22 }, "By vehicle"),
    Row(
      { gap: 22, align: "center" },
      PieChart({
        width: 170,
        height: 150,
        donut: true,
        legend: false,
        data: fleet.map(([name, , trips]) => ({ label: name, value: trips })),
        colors: [accent, "#14110F", "#C9C3B5"],
      }),
      Table({
        grow: 1,
        basis: 0,
        columns: [{ width: "1fr" }, { width: 50, align: "end" }, { width: 56, align: "end" }, { width: 66, align: "end" }],
        header: ["Vehicle", "Fleet", "Trips", "Occupancy"],
        rows: fleet.map(([name, count, trips, share]) => [name, count, trips.toLocaleString("en-US"), share]),
        footer: [[Text({ font: bold }, "All vehicles"), 73, "3,327", "66%"]],
        headerStyle: { font: medium, size: 7, color: muted },
        cellPadding: [6, 0],
        borders: { horizontal: { width: 0.5, color: rule }, header: { width: 1, color: ink }, footer: { width: 1, color: ink } },
      }),
    ),
  ),
);
