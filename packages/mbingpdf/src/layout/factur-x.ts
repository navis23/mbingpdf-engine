/**
 * Factur-X and ZUGFeRD: an invoice people can read as a PDF and software can read as XML,
 * in one file. The XML rides inside a PDF/A-3 file, and the file's metadata says so.
 */
import type { MetadataSchema, PdfAttachment, PdfMetadata } from "../core/index.ts";

/** How much of the invoice the XML holds, from the bare totals up to every line. */
export type FacturXProfile = "MINIMUM" | "BASIC WL" | "BASIC" | "EN 16931" | "EXTENDED";

export interface FacturXOptions {
  /** The invoice as Cross Industry Invoice XML. This library does not write or check it. */
  xml: string | Uint8Array;
  profile: FacturXProfile;
  /** The kind of document. Default `"INVOICE"`. */
  documentType?: "INVOICE" | "ORDER";
  /** The version of the standard the XML follows. Default `"1.0"`. */
  version?: string;
  /** When the XML was made; left out of the file otherwise. */
  modified?: Date;
}

const FILE_NAME = "factur-x.xml";

const SCHEMA: MetadataSchema = {
  name: "Factur-X PDFA Extension Schema",
  uri: "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#",
  prefix: "fx",
  properties: [
    {
      name: "DocumentFileName",
      type: "Text",
      category: "external",
      description: "The name of the embedded XML document",
    },
    {
      name: "DocumentType",
      type: "Text",
      category: "external",
      description: "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER",
    },
    {
      name: "Version",
      type: "Text",
      category: "external",
      description: "The actual version of the standard applying to the embedded XML document",
    },
    {
      name: "ConformanceLevel",
      type: "Text",
      category: "external",
      description: "The conformance level of the embedded XML document",
    },
  ],
};

/**
 * The attachment and metadata that make a document a Factur-X (ZUGFeRD 2) invoice. Spread the
 * result into the `Document`'s properties and render with `conformance: "PDF/A-3b"`:
 *
 * ```ts
 * Document({ title: "Invoice 42", ...facturX({ xml, profile: "EN 16931" }) }, ...)
 * ```
 */
export function facturX(options: FacturXOptions): {
  attachments: PdfAttachment[];
  metadata: PdfMetadata[];
} {
  // With the two smallest profiles the PDF says more than the XML, which is then only data
  // about it; from BASIC up the XML is the same invoice in another form.
  const partial = options.profile === "MINIMUM" || options.profile === "BASIC WL";
  return {
    attachments: [
      {
        name: FILE_NAME,
        data: options.xml,
        mimeType: "text/xml",
        description: "Factur-X invoice",
        relationship: partial ? "Data" : "Alternative",
        ...(options.modified ? { modified: options.modified } : {}),
      },
    ],
    metadata: [
      {
        schema: SCHEMA,
        values: {
          DocumentType: options.documentType ?? "INVOICE",
          DocumentFileName: FILE_NAME,
          Version: options.version ?? "1.0",
          ConformanceLevel: options.profile,
        },
      },
    ],
  };
}
