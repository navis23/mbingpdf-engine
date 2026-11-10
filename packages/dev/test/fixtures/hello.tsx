import { readFileSync } from "node:fs";
import { Document, Link, Page, PageBreak, Text } from "mbingpdf";
import { title } from "./title.ts";

// Read relative to this file, to check that the path survives bundling.
const note = readFileSync(new URL("./note.txt", import.meta.url), "utf8").trim();

export const options = { deterministic: true };

export default () => (
  <Document title={title}>
    <Page size="A6" margin={24}>
      <Text>{title}</Text>
      <Text>{note}</Text>
      <Text>
        <Link href="https://example.com">a link</Link>
      </Text>
      <PageBreak />
      <Text>Second page</Text>
    </Page>
  </Document>
);
