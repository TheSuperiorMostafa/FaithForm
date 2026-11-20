"use client";

import { useEffect } from "react";
import { LAST_TYPE_COOKIE } from "@/lib/service-plans/remember";

/** Notes the service type being viewed, for the Plans menu's landing page. */
export function RememberLastType({ serviceTypeId }: { serviceTypeId: string }) {
  useEffect(() => {
    document.cookie = `${LAST_TYPE_COOKIE}=${encodeURIComponent(serviceTypeId)}; path=/dashboard/plans; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
  }, [serviceTypeId]);
  return null;
}
