"use client";

import { useState } from "react";

export function ProfileAvatar({ url, initials }: { url?: string | null; initials: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return url && url !== failedUrl ? (
    // Public, server-normalized rendition; preserve the surrounding avatar size.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="size-full rounded-full object-cover" onError={() => setFailedUrl(url)} />
  ) : <>{initials}</>;
}
