/** @jsxImportSource ../src */
import { describe, expect, test } from "vitest";
import {
  type Child,
  Document,
  Heading,
  Image,
  inspect,
  type LayoutNode,
  Link,
  List,
  layoutDocument,
  Page,
  PageBreak,
  Row,
  render,
  Spacer,
  Span,
  Stack,
  Table,
  Text,
} from "../src/index.ts";
import { env } from "./harness/env.ts";
import { extractText } from "./harness/render.ts";

describe("JSX", () => {
  test("produces the same data as the function calls", () => {
    const fromJsx = (
      <Stack gap={4} padding={[2, 4]}>
        <Text size={12}>Halo</Text>
        <Row justify="space-between">
          <Text>kiri</Text>
          <Spacer />
          <Text color="#ff0000">kanan</Text>
        </Row>
      </Stack>
    );
    const fromCalls = Stack(
      { gap: 4, padding: [2, 4] },
      Text({ size: 12 }, "Halo"),
      Row(
        { justify: "space-between" },
        Text("kiri"),
        Spacer(),
        Text({ color: "#ff0000" }, "kanan"),
      ),
    );
    // JSX wraps several children in one list; laid out, the two are the same document.
    const layoutOf = (node: LayoutNode) =>
      layoutDocument(Document(Page({ size: [200, 100], margin: 10 }, node))).pages;
    expect(layoutOf(fromJsx)).toEqual(layoutOf(fromCalls));
  });

  test("text, spans, links and expressions", async () => {
    const total = 4_850_000;
    const paid = true;
    const document = (
      <Document title="Faktur">
        <Page size={[300, 200]} margin={10}>
          <Heading level={2}>Faktur</Heading>
          <Text>
            Total <Span color="#b91c1c">Rp {total.toLocaleString("en-US").replace(/,/g, ".")}</Span>
            , lihat <Link href="https://example.com">rincian</Link>.
          </Text>
          {paid && <Text>Lunas</Text>}
          {!paid && <Text>Belum lunas</Text>}
          {null}
        </Page>
      </Document>
    );
    const pdf = await render(document, { deterministic: true });
    const text = (await extractText(pdf))[0]?.join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Faktur");
    expect(text).toContain("Rp 4.850.000");
    expect(text).toContain("Lunas");
    expect(text).not.toContain("Belum");
  });

  test("lists of elements, fragments, and components of your own", () => {
    const Field = (props: { label: string; children?: Child }): LayoutNode => (
      <Row gap={6}>
        <Text width={50} color="#666666">
          {props.label}
        </Text>
        <Text>{props.children}</Text>
      </Row>
    );
    const items = ["satu", "dua", "tiga"];
    const document = (
      <Document>
        <Page size={[300, 300]} margin={10}>
          <Field label="Nama">Budi</Field>
          <Field label="Kota">Bandung</Field>
          <>
            <Text>dalam fragmen</Text>
            <Text>juga</Text>
          </>
          <List marker="decimal">
            {items.map((item) => (
              <Text>{item}</Text>
            ))}
          </List>
          <PageBreak />
          <Table columns={2} rows={[["a", "b"]]} />
          <Image src={env.photo} width={40} />
        </Page>
      </Document>
    );
    const pages = inspect(document);
    expect(pages).toHaveLength(2);
    const texts = JSON.stringify(pages);
    for (const word of [
      "Nama",
      "Budi",
      "Kota",
      "Bandung",
      "dalam fragmen",
      "juga",
      "1.",
      "satu",
      "3.",
      "tiga",
    ]) {
      expect(texts).toContain(`"${word}"`);
    }
    expect(pages[1]?.boxes[0]?.children?.map((box) => box.type)).toEqual(["Table", "Image"]);
  });

  test("a component may return a list or nothing", () => {
    const Pair = (): Child[] => [<Text>a</Text>, <Text>b</Text>];
    const Nothing = (): null => null;
    const document = (
      <Document>
        <Page size={[100, 100]} margin={10}>
          <Pair />
          <Nothing />
          <Text>c</Text>
        </Page>
      </Document>
    );
    const body = inspect(document)[0]?.boxes[0];
    expect(body?.children?.map((box) => box.text?.[0])).toEqual(["a", "b", "c"]);
  });
});
