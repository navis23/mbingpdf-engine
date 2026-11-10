# mbingpdf — project plan

`mbingpdf` is a TypeScript library for generating production-grade PDF documents in any JavaScript runtime.

These documents are the plan we agree on before writing code. Nothing here is built yet.

| Doc | What it answers |
| --- | --- |
| [01-landscape.md](./01-landscape.md) | What exists today, and where each library falls short |
| [02-vision.md](./02-vision.md) | What we are building, for whom, and what we will not build |
| [03-architecture.md](./03-architecture.md) | The layers of the engine and the technical choices behind them |
| [04-api-design.md](./04-api-design.md) | What using the library looks like |
| [05-roadmap.md](./05-roadmap.md) | Milestones, in order, each with a testable exit condition |
| [06-quality.md](./06-quality.md) | How we prove the output is correct and precise |
| [07-open-decisions.md](./07-open-decisions.md) | What is decided, what is assumed |
| [08-target-documents.md](./08-target-documents.md) | The real documents the library is designed against |

## The plan in one paragraph

Existing JS libraries each solve one piece: jsPDF and PDFKit draw at coordinates, pdfmake and react-pdf lay out documents but with limited typography and pagination control, and headless Chrome gives full CSS at the cost of shipping a browser. We build one pure-TypeScript engine with three layers — a PDF writer, a font and text engine, and a pagination-aware layout engine — and expose it through a declarative, fully typed document API. The same input produces the same bytes in Node, Bun, Deno, browsers and workers. Tagged, accessible, archivable output (PDF/UA, PDF/A) comes from the document's semantic structure rather than from extra work by the user.
