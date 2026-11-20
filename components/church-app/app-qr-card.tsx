"use client";

import { useState } from "react";
import { Download, FileDown, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { FlyerColors } from "@/components/church-app/app-flyer-content";
import { APP_QR_CARD_DESCRIPTION, APP_QR_CARD_TITLE } from "@/components/church-app/app-qr-copy";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type DownloadKind = "flyer" | "png" | "svg";

const DOWNLOADS: Record<DownloadKind, { href: string; success: string; failure: string }> = {
  flyer: {
    href: "/api/church-app/flyer",
    success: "Flyer downloaded. It prints on standard letter paper.",
    failure: "We couldn't make your flyer. Please try again.",
  },
  png: {
    href: "/api/church-app/qr?format=png&download=1",
    success: "QR code downloaded. Add it to a slide, bulletin or email.",
    failure: "We couldn't make your QR code. Please try again.",
  },
  svg: {
    href: "/api/church-app/qr?format=svg&download=1",
    success: "QR code downloaded as SVG for your designer.",
    failure: "We couldn't make your QR code. Please try again.",
  },
};

function fileNameFrom(response: Response, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
  return match?.[1] ?? fallback;
}

/**
 * The church's "Get the app" QR code and printable flyer, both in the
 * church's app colors. Downloads go through fetch so a failure shows a plain
 * message instead of saving an error page as a file.
 */
export function AppQrCard({
  churchName,
  logoUrl,
  colors,
  findableInSearch,
}: {
  churchName: string;
  logoUrl: string | null;
  colors: FlyerColors;
  findableInSearch: boolean;
}) {
  const [busy, setBusy] = useState<DownloadKind | null>(null);
  // A new color makes a new address, so the preview follows a color change.
  const previewSrc = `/api/church-app/qr?format=svg&v=${encodeURIComponent(colors.qrInk)}`;

  const download = async (kind: DownloadKind) => {
    const target = DOWNLOADS[kind];
    setBusy(kind);
    try {
      const response = await fetch(target.href, { cache: "no-store" });
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(response, kind === "flyer" ? "app-flyer.pdf" : `app-qr-code.${kind}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast.success(target.success);
    } catch {
      toast.error(target.failure);
    } finally {
      setBusy(null);
    }
  };

  const name = churchName.trim();

  return (
    <Card className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="space-y-1.5">
          <h3 className="font-heading text-lg font-bold text-foreground">{APP_QR_CARD_TITLE}</h3>
          <p className="text-[15px] leading-relaxed text-muted-foreground">{APP_QR_CARD_DESCRIPTION}</p>
        </div>

        {!findableInSearch && (
          <p className="flex gap-2 rounded-xl border border-border bg-muted/40 p-3 text-[15px] text-foreground">
            <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            Your church isn&apos;t listed in app search, so the flyer asks people to get an
            invitation link from you.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => download("flyer")} disabled={busy !== null}>
            {busy === "flyer" ? <Loader2 className="animate-spin" aria-hidden /> : <FileDown aria-hidden />}
            {busy === "flyer" ? "Making your flyer…" : "Download flyer (PDF)"}
          </Button>
          <Button type="button" variant="outline" onClick={() => download("png")} disabled={busy !== null}>
            {busy === "png" ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            Download QR code
          </Button>
          <Button type="button" variant="ghost" onClick={() => download("svg")} disabled={busy !== null}>
            {busy === "svg" ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            QR code as SVG
          </Button>
        </div>
      </div>

      <FlyerPreview name={name} logoUrl={logoUrl} colors={colors} qrSrc={previewSrc} />
    </Card>
  );
}

/** A small likeness of the printed flyer, so the colors are no surprise. */
function FlyerPreview({
  name,
  logoUrl,
  colors,
  qrSrc,
}: {
  name: string;
  logoUrl: string | null;
  colors: FlyerColors;
  qrSrc: string;
}) {
  return (
    <figure className="flex shrink-0 flex-col items-center gap-2 self-center">
      <div
        className="relative flex aspect-[8.5/11] w-[176px] flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm"
        aria-hidden
      >
        <div
          className="flex h-[42%] flex-col items-center gap-1 px-3 pt-3 text-center"
          style={{ backgroundColor: colors.primary, color: colors.onPrimary }}
        >
          <div className="flex max-w-full items-center gap-1.5">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="size-4 shrink-0 rounded-sm bg-white object-contain p-px" />
            )}
            <span className="truncate text-[7px] font-bold tracking-wide uppercase">{name || "Your church"}</span>
          </div>
          <span className="mt-0.5 h-0.5 w-5 rounded-full" style={{ backgroundColor: colors.accentOnPrimary }} />
          <span className="font-heading text-[13px] leading-tight font-bold">Our church has an app</span>
        </div>
        <div
          className="absolute top-[30%] left-1/2 -translate-x-1/2 rounded-md border-2 bg-white p-1.5"
          style={{ borderColor: colors.accentOnWhite }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc} alt="" width={80} height={80} className="size-20" />
        </div>
        <div className="mt-auto flex flex-col gap-1 px-4 pb-3">
          {[0, 1, 2].map((step) => (
            <div key={step} className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors.primary }} />
              <span className="h-1 flex-1 rounded-full bg-neutral-200" />
            </div>
          ))}
        </div>
        <span className="h-1.5 w-full" style={{ backgroundColor: colors.accentOnWhite }} />
      </div>
      <figcaption className="text-sm text-muted-foreground">Printed in your app colors</figcaption>
    </figure>
  );
}
