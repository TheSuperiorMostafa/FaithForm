import "server-only";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";

import { InvoicePdfDocument } from "@/components/billing/invoice-pdf";
import type { ChurchInvoice } from "@/lib/billing/invoice";

export async function renderInvoicePdf(invoice: ChurchInvoice): Promise<Uint8Array> {
  const buffer = await renderToBuffer(
    createElement(InvoicePdfDocument, { invoice }) as unknown as ReactElement<DocumentProps>,
  );
  return new Uint8Array(buffer);
}
