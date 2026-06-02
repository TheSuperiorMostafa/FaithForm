"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function QrCodeCard({ givePageUrl }: { givePageUrl: string }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    setQrUrl(`/api/dashboard/giving/qr?url=${encodeURIComponent(givePageUrl)}`);
  }, [givePageUrl]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Give page QR code</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {qrUrl && (
          <Image
            src={qrUrl}
            alt="QR code for give page"
            width={200}
            height={200}
            unoptimized
          />
        )}
        <p className="text-center text-xs text-muted-foreground break-all">
          {givePageUrl}
        </p>
        {qrUrl && (
          <a
            href={qrUrl}
            download="give-page-qr.png"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
          >
            Download QR code
          </a>
        )}
      </CardContent>
    </Card>
  );
}
