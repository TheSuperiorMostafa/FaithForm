"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, Copy, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The church's giving link and its QR code, side by side: copy it for an
 * email or the bulletin, open it to check, or download the QR code for a
 * slide or a printed card.
 */
export function GivingLinkCard({
  givePageUrl,
  title = "Your giving link",
  description = "Share it in emails, on your website and in the bulletin. The QR code opens the same page.",
  className,
}: {
  givePageUrl: string;
  title?: string;
  description?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const qrUrl = `/api/dashboard/giving/qr?url=${encodeURIComponent(givePageUrl)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(givePageUrl);
      setCopied(true);
      toast.success("Giving link copied. Paste it anywhere to share it.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("We couldn't copy the link. Select it and copy it yourself.");
    }
  };

  return (
    <Card className={cn("flex flex-col gap-6 p-6 sm:flex-row sm:items-center", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="space-y-1.5">
          <h2 className="font-heading text-xl font-bold text-foreground">{title}</h2>
          <p className="text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <p className="break-all rounded-xl border border-border bg-muted/40 px-4 py-3 text-base font-medium text-foreground">
          {givePageUrl}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={copy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <a
            href={givePageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            <ExternalLink aria-hidden />
            Open giving page
          </a>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-3">
        <div className="rounded-2xl border border-border bg-white p-2">
          <Image
            src={qrUrl}
            alt="QR code that opens your giving page"
            width={160}
            height={160}
            unoptimized
            className="size-40"
          />
        </div>
        <a
          href={qrUrl}
          download="giving-page-qr-code.png"
          className={buttonVariants({ variant: "ghost" })}
        >
          <Download aria-hidden />
          Download QR code
        </a>
      </div>
    </Card>
  );
}
