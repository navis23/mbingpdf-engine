# Benchmarks

How mbingpdf compares with three other JavaScript PDF libraries on speed and file size. The script is `benchmarks/run.mjs`; run it yourself with:

```sh
pnpm build
pnpm --filter mbingpdf-benchmarks bench -- --runs 3
```

## What is measured

Three documents, built by each library from the same data with the same embedded font (Barlow Condensed, regular and bold), on A4 with 40 pt margins:

| Document | Content |
| --- | --- |
| Invoice | One page: a heading, two address blocks, a table of 12 lines with a total |
| Table | 2,000 rows in 5 columns, the header repeated on every page |
| Text | 300 paragraphs of about 80 words, with a heading before every tenth |

Each library uses its own table and text features as its documentation recommends: `Table` in mbingpdf, `doc.table()` in PDFKit, a `table` node in pdfmake, rows of `View` and `Text` in @react-pdf/renderer. The time is the median of three runs after one warm-up run, in a single Node process; the size is that of the finished file. The outputs were rendered and compared by eye: the same content in the same layout, with small differences in row height that explain the different page counts.

## Results

Measured on 2026-11-10 with Node 26.12 on an Intel Core i7-8565U laptop (1.8 GHz). Versions: mbingpdf at commit `91ef2f6`, PDFKit 0.17.2, pdfmake 0.2.23, @react-pdf/renderer 4.9.0.

### Invoice, 1 page

| Library | Time | File size |
| --- | ---: | ---: |
| mbingpdf | 22 ms | 18.3 kB |
| PDFKit | 293 ms | 19.4 kB |
| pdfmake | 77 ms | 19.8 kB |
| @react-pdf/renderer | 72 ms | 20.4 kB |

### Table, 2,000 rows

| Library | Time | File size | Pages |
| --- | ---: | ---: | ---: |
| mbingpdf | 1.90 s | 156.4 kB | 56 |
| PDFKit | 29.10 s | 248.6 kB | 53 |
| pdfmake | 1.02 s | 250.3 kB | 47 |
| @react-pdf/renderer | 25.93 s | 313.1 kB | 56 |

### Text, 300 paragraphs

| Library | Time | File size | Pages |
| --- | ---: | ---: | ---: |
| mbingpdf | 468 ms | 80.1 kB | 24 |
| PDFKit | 261 ms | 87.8 kB | 23 |
| pdfmake | 677 ms | 219.7 kB | 24 |
| @react-pdf/renderer | 1.60 s | 116.7 kB | 24 |

## Reading the numbers

- mbingpdf is the fastest on the invoice and writes the smallest file in all three documents.
- It is **not** the fastest everywhere. pdfmake lays out the long table in about half the time, and PDFKit sets plain paragraphs in a little over half the time. PDFKit's text call does less: no Unicode line-breaking rules, no shaping beyond what the font's basic tables give.
- PDFKit's table feature and @react-pdf/renderer both slow down sharply on the 2,000-row table.
- Times vary from run to run by 10–30% on this machine, more for the short invoice. Treat differences smaller than that as equal.
- One machine, one Node version, three documents. Documents with many images, complex scripts or very different structure may rank the libraries differently.

The long table is the place where mbingpdf has the most to gain; it is listed in the roadmap as follow-up work.
