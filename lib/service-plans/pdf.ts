import "server-only";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";

import {
  PlanPdfDocument,
  type PlanPdfBrand,
  type PlanPdfOrientation,
} from "@/components/service-plans/pdf/plan-pdf";
import type { Plan, SharePreset } from "@/lib/service-plans/types";
import { buildPlanView, type PlanViewOptions } from "@/lib/service-plans/view";

export type { PlanPdfBrand, PlanPdfOrientation };

export type RenderPlanPdfInput = {
  plan: Plan;
  options: PlanViewOptions;
  churchName: string;
  /** IANA zone the times are printed in, e.g. "America/Chicago". */
  timeZone: string;
  /**
   * The church logo: a `data:` URI, or the church's `logo_url`. A URL is only
   * fetched when it is in this project's public Supabase storage; anything
   * else, or a logo that fails to load, prints without one.
   */
  logoSrc?: string | null;
  orientation?: PlanPdfOrientation;
  brand?: PlanPdfBrand;
  /** Who this copy is for, e.g. "Worship team". */
  audience?: string | null;
  generatedAt?: Date;
};

/** Renders one audience's view of a plan to PDF bytes. */
export async function renderPlanPdf(input: RenderPlanPdfInput): Promise<Buffer> {
  const view = buildPlanView(input.plan, input.options);
  const logo = await resolvePlanLogo(input.logoSrc ?? null);
  const element = createElement(PlanPdfDocument, {
    view,
    churchName: input.churchName,
    logoSrc: logo,
    timeZone: input.timeZone,
    generatedAt: input.generatedAt ?? new Date(),
    brand: input.brand,
    orientation: input.orientation ?? "portrait",
    audience: input.audience ?? null,
  }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}

const LOGO_MAX_BYTES = 5 * 1024 * 1024;

function imageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Only the project's own public storage is fetched, so a typed-in URL cannot make the server call elsewhere. */
function isOwnPublicStorage(url: URL): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  try {
    const origin = new URL(base).origin;
    return url.origin === origin && url.pathname.startsWith("/storage/v1/object/public/");
  } catch {
    return false;
  }
}

/**
 * A logo react-pdf can draw (PNG or JPEG data URI), or null. Never throws: a
 * missing or broken logo must not stop the plan printing.
 */
export async function resolvePlanLogo(src: string | null): Promise<string | null> {
  if (!src) return null;
  if (/^data:image\/(png|jpeg);base64,/i.test(src)) return src;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (!isOwnPublicStorage(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "error" });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > LOGO_MAX_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > LOGO_MAX_BYTES) return null;
    const mime = imageMime(bytes);
    return mime ? `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` : null;
  } catch {
    return null;
  }
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const PRESET_FILE_SUFFIX: Record<SharePreset, string> = {
  order: "order-of-service",
  full: "full-plan",
  team: "team-plan",
  person: "person-plan",
};

/** `sunday-morning-2026-11-23-order-of-service.pdf` */
export function planPdfFileName(plan: Pick<Plan, "serviceTypeName" | "date">, preset: SharePreset): string {
  const parts = [slug(plan.serviceTypeName) || "service-plan", plan.date, PRESET_FILE_SUFFIX[preset]];
  return `${parts.filter(Boolean).join("-")}.pdf`;
}
