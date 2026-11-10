/** Password protection: the files open with the right password and only with it. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createEncryptor, PdfDocument, StandardFonts } from "../src/core/index.ts";
import { Document, Font, Image, Link, Page, render, Text } from "../src/index.ts";
import { env, readFont } from "./harness/env.ts";
import { extractText, renderPdf } from "./harness/render.ts";

const inter = new Font(readFont("Inter-Variable"));
const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;
const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

const secret = Document(
  { title: "Judul rahasia", author: "Penulis rahasia", font: inter },
  Page(
    Text("Isi yang dirahasiakan. ", Link({ href: "https://example.com/rahasia" }, "Tautan")),
    Image({ src: env.photo, width: 80 }),
  ),
);

/** Runs qpdf on a file and returns what it printed. */
function qpdf(pdf: Uint8Array, ...args: string[]): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "mbingpdf-enc-"));
  try {
    const file = join(dir, "file.pdf");
    writeFileSync(file, pdf);
    const result = spawnSync("qpdf", [...args, file], { encoding: "utf8" });
    return { ok: result.status === 0, output: result.stdout + result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("encryption", () => {
  test("opens with the password, and shows what the plain file shows", async () => {
    const plain = await render(secret, { deterministic: true });
    const locked = await render(secret, {
      deterministic: true,
      encryption: { userPassword: "rahasia" },
    });
    expect(await extractText(locked, "rahasia")).toEqual(await extractText(plain));
    for (const renderer of ["pdfjs", "pdfium"] as const) {
      const expected = await renderPdf(renderer, plain);
      const actual = await renderPdf(renderer, locked, undefined, "rahasia");
      expect(actual.length).toBe(1);
      expect(
        Buffer.from(actual[0]?.pixels as Uint8Array).equals(
          Buffer.from(expected[0]?.pixels as Uint8Array),
        ),
      ).toBe(true);
    }
  });

  test("does not open without the password or with a wrong one", async () => {
    const locked = await render(secret, { encryption: { userPassword: "rahasia" } });
    await expect(extractText(locked)).rejects.toThrow(/password/i);
    await expect(extractText(locked, "salah")).rejects.toThrow(/password/i);
  });

  test("nothing readable is left in the file", async () => {
    for (const compress of [true, false]) {
      const locked = latin1(
        await render(secret, { compress, encryption: { userPassword: "rahasia" } }),
      );
      for (const leak of ["Judul", "Penulis", "example.com", "dc:title", "/Type/Page", "Inter"]) {
        expect(locked).not.toContain(leak);
      }
      // What a reader needs before it has the key stays in the clear.
      expect(locked).toContain("/Filter/Standard/V 5/R 6/Length 256");
      expect(locked).toContain("/CFM/AESV3");
      expect(locked).toMatch(/\/Type\/XRef\b/);
    }
  });

  test("the classic file layout encrypts each string", () => {
    const build = (encrypted: boolean): string => {
      const doc = new PdfDocument({
        xref: "table",
        info: { title: "Judul rahasia" },
        deterministic: true,
        ...(encrypted ? { encryption: { userPassword: "é" } } : {}),
      });
      doc
        .addPage({ size: [200, 100] })
        .content.font(StandardFonts.Helvetica, 12)
        .beginText()
        .moveText(10, 50)
        .showText("Halo")
        .endText();
      return latin1(doc.finish());
    };
    expect(build(false)).toContain("(Judul rahasia)");
    const locked = build(true);
    expect(locked).not.toContain("Judul");
    expect(locked).not.toContain("Halo");
    expect(locked).toMatch(/trailer\n<<.*\/Encrypt \d+ 0 R/s);
    expect(locked).toContain("/Extensions<</ADBE<</BaseVersion/1.7/ExtensionLevel 8>>>>");
  });

  test("without a user password the file opens for anyone, restrictions included", async () => {
    const locked = await render(secret, { encryption: { permissions: { copy: false } } });
    expect(await extractText(locked)).toEqual([["Isi yang dirahasiakan. Tautan"]]);
  });

  test("permissions are the standard's bits", () => {
    const p = (permissions: Parameters<typeof createEncryptor>[0]["permissions"]): number =>
      createEncryptor(
        { userPassword: "x", ...(permissions ? { permissions } : {}) },
        true,
      ).dict.get("P") as number;
    expect(p(undefined)).toBe(-4);
    expect(p({ print: false })).toBe(-4 - 4 - 2048);
    expect(p({ print: "low" })).toBe(-4 - 2048);
    expect(p({ modify: false })).toBe(-4 - 8);
    expect(p({ copy: false })).toBe(-4 - 16);
    expect(p({ annotate: false })).toBe(-4 - 32);
    expect(p({ fillForms: false })).toBe(-4 - 256);
    expect(p({ assemble: false })).toBe(-4 - 1024);
  });

  test("a deterministic build repeats; an ordinary one never does", async () => {
    const options = { encryption: { userPassword: "rahasia", ownerPassword: "pemilik" } };
    const first = await render(secret, { ...options, deterministic: true });
    const second = await render(secret, { ...options, deterministic: true });
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    const third = await render(secret, options);
    const fourth = await render(secret, options);
    expect(Buffer.from(third).equals(Buffer.from(fourth))).toBe(false);
    // A long password is cut to 127 bytes, as the standard says; both sides agree on that.
    const long = "p".repeat(200);
    const cut = await render(secret, { encryption: { userPassword: long } });
    expect(await extractText(cut, "p".repeat(127))).toEqual([["Isi yang dirahasiakan. Tautan"]]);
  });

  test("archival and print standards refuse it; accessibility does not", async () => {
    const encryption = { userPassword: "x" };
    await expect(render(secret, { conformance: "PDF/A-2b", encryption })).rejects.toThrow(
      "PDF/A-2b does not allow a file to be encrypted",
    );
    await expect(
      render(secret, {
        conformance: ["PDF/UA-1", "PDF/X-4"],
        outputIntent: { profile: env.icc, identifier: "x" },
        encryption,
      }),
    ).rejects.toThrow("PDF/X-4 does not allow a file to be encrypted");
    const accessible = Document({ title: "Judul", lang: "id", font: inter }, Page(Text("Isi")));
    const locked = await render(accessible, { conformance: "PDF/UA-1", encryption });
    expect(await extractText(locked, "x")).toEqual([["Isi"]]);
  });

  test.skipIf(!hasQpdf)(
    "qpdf reads it with either password and reports the permissions",
    async () => {
      const locked = await render(secret, {
        encryption: {
          userPassword: "rahasia",
          ownerPassword: "pemilik",
          permissions: { print: "low", copy: false, modify: false },
        },
      });
      const asUser = qpdf(locked, "--password=rahasia", "--show-encryption");
      expect(asUser.ok).toBe(true);
      expect(asUser.output).toContain("R = 6");
      expect(asUser.output).toContain("Supplied password is user password");
      expect(asUser.output).toContain("extract for accessibility: allowed");
      expect(asUser.output).toContain("extract for any purpose: not allowed");
      expect(asUser.output).toContain("print low resolution: allowed");
      expect(asUser.output).toContain("print high resolution: not allowed");
      expect(asUser.output).toContain("modify other: not allowed");
      expect(asUser.output).toContain("file encryption method: AESv3");
      const asOwner = qpdf(locked, "--password=pemilik", "--show-encryption");
      expect(asOwner.output).toContain("Supplied password is owner password");
      for (const password of ["rahasia", "pemilik"]) {
        const check = qpdf(locked, `--password=${password}`, "--check");
        expect(check.output).toContain("No syntax or stream encoding errors found");
        expect(check.ok).toBe(true);
      }
      expect(qpdf(locked, "--password=salah", "--check").output).toContain("invalid password");
      // Without an owner password nobody holds one: the user password is not it.
      const noOwner = await render(secret, { encryption: { userPassword: "rahasia" } });
      expect(qpdf(noOwner, "--password=rahasia", "--show-encryption").output).toContain(
        "Supplied password is user password",
      );
    },
  );
});
