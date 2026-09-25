"use client";

import { useEffect, useState, type ReactNode } from "react";

import { draftHasWork, draftKey, readDraft } from "@/components/attendance/attendance-draft";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * "In progress" for a Sunday someone started counting in this browser and
 * hasn't saved. The server can't know about a draft, so this checks after the
 * page loads and otherwise shows what the server said.
 */
export function SundayDraftBadge({ serviceDate, fallback }: { serviceDate: string; fallback: ReactNode }) {
  const [inProgress, setInProgress] = useState(false);

  useEffect(() => {
    const draft = readDraft(draftKey(serviceDate));
    setInProgress(Boolean(draft && draftHasWork(draft)));
  }, [serviceDate]);

  return inProgress ? <StatusBadge tone="working">In progress</StatusBadge> : <>{fallback}</>;
}
