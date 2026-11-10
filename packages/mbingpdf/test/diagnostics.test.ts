import { describe, expect, test } from "vitest";
import {
  Box,
  Document,
  Heading,
  inspect,
  LayoutError,
  layoutDocument,
  Page,
  Row,
  render,
  Stack,
  TableOfContents,
  Text,
} from "../src/index.ts";

describe("inspect", () => {
  test("returns every element's box as plain data", () => {
    const pages = inspect(
      Document(
        Page(
          { size: [200, 300], margin: 10, footer: Text("kaki") },
          Stack(
            { gap: 4, id: "utama" },
            Text("satu\ndua"),
            Row(Box({ width: 30, height: 10 }), Text("samping")),
          ),
        ),
      ),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]?.page).toBe(1);
    const [body, footer] = pages[0]?.boxes ?? [];
    expect(body).toMatchObject({ type: "Stack", x: 10, y: 10, width: 180 });
    const main = body?.children?.[0];
    expect(main).toMatchObject({ type: "Stack", id: "utama", x: 10, y: 10 });
    expect(main?.children?.[0]).toEqual({
      type: "Text",
      x: 10,
      y: 10,
      width: 180,
      height: 23,
      text: ["satu", "dua"],
    });
    expect(main?.children?.[1]).toMatchObject({ type: "Row", y: 37 });
    expect(main?.children?.[1]?.children?.[0]).toMatchObject({
      type: "Stack",
      width: 30,
      height: 11.5,
    });
    expect(footer).toMatchObject({ type: "Stack", y: 278.5 });
    expect(footer?.children?.[0]?.text).toEqual(["kaki"]);
    // Plain data: it survives a round trip through JSON unchanged.
    expect(JSON.parse(JSON.stringify(pages))).toEqual(pages);
  });

  test("reports each page of a document that flows over several", () => {
    const lines = Array.from({ length: 60 }, (_value, i) => Text(`baris ${i + 1}`));
    const pages = inspect(Document(Page({ size: [200, 300], margin: 10 }, lines)));
    expect(pages.map((page) => page.page)).toEqual([1, 2, 3]);
    expect(pages[1]?.boxes[0]?.children?.[0]?.text).toEqual(["baris 25"]);
  });

  test("settles a table of contents first", () => {
    const pages = inspect(
      Document(
        Page({ size: [200, 300], margin: 10 }, TableOfContents(), Heading("Satu"), Text("isi")),
      ),
    );
    expect(JSON.stringify(pages[0]?.boxes)).toContain('"Satu"');
    expect(() => inspect(Text("x") as never)).toThrow(/needs a Document/);
  });
});

describe("warnings and strict mode", () => {
  const document = Document(
    Page({ size: [200, 300], margin: 10 }, Text("baik"), Stack(Row(Text("ada 日 di sini")))),
  );

  test("a warning says where in the document the problem is", async () => {
    const warnings: { message: string; path?: string }[] = [];
    await render(document, { onWarning: (warning) => warnings.push(warning) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('"日"');
    expect(warnings[0]?.path).toBe("Document > Page[0] > Stack[1] > Row[0]");
    expect(layoutDocument(document).warnings[0]?.path).toBe(
      "Document > Page[0] > Stack[1] > Row[0]",
    );
  });

  test("strict mode turns the first warning into an error", async () => {
    await expect(render(document, { strict: true })).rejects.toThrow(LayoutError);
    await expect(render(document, { strict: true })).rejects.toThrow(
      /No font in use has a glyph for "日".*\(at Document > Page\[0\] > Stack\[1\] > Row\[0\]\)/,
    );
    // Without problems, strict mode changes nothing.
    const clean = Document(Page({ size: [200, 300], margin: 10 }, Text("baik")));
    expect(await render(clean, { strict: true, deterministic: true })).toEqual(
      await render(clean, { deterministic: true }),
    );
  });
});

describe("debug overlay", () => {
  test("outlines every box", () => {
    const document = Document(Page({ size: [200, 300], margin: 10 }, Stack(Text("a"), Text("b"))));
    const plain = layoutDocument(document).pages[0]?.items ?? [];
    const debug = layoutDocument(document, { debug: true }).pages[0]?.items ?? [];
    const outlines = debug.filter((item) => item.type === "path" && item.stroke?.width === 0.25);
    // The page body, the stack, and the two texts.
    expect(outlines).toHaveLength(4);
    expect(debug.length).toBe(plain.length + 4);
  });

  test("is available from render()", async () => {
    const document = Document(Page({ size: [200, 300], margin: 10 }, Text("a")));
    const plain = await render(document, { deterministic: true, compress: false });
    const debug = await render(document, { deterministic: true, compress: false, debug: true });
    expect(debug.length).toBeGreaterThan(plain.length);
    expect(new TextDecoder("latin1").decode(debug)).toContain("0.25 w");
  });
});
