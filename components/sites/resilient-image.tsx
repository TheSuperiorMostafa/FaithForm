"use client";

import React, { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A removed or unreachable upload keeps its layout without a broken-image icon. */
export function ResilientImage({
  fallback = "placeholder",
  ...props
}: Omit<ComponentProps<"img">, "onError"> & { fallback?: "placeholder" | "hide" }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = typeof props.src === "string" ? props.src : "";
  if (!source || failedSource === source) {
    if (fallback === "hide") return null;
    return <div
      className={cn("site-ph", props.className)}
      style={props.style}
      data-ph="Photo unavailable"
      role={props.alt ? "img" : undefined}
      aria-label={props.alt ? `Photo unavailable: ${props.alt}` : undefined}
      aria-hidden={props.alt ? undefined : true}
    />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- church-supplied URL
  return <img {...props} alt={props.alt ?? ""} onError={() => setFailedSource(source)} />;
}
