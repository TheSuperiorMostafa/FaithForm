"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OccurrencesManager } from "./occurrences-manager";

export function AnnouncementWithOccurrences({
  announcementId,
  title,
  hasRecurrence,
  children,
}: {
  announcementId: string;
  title: string;
  hasRecurrence: boolean;
  children: React.ReactNode;
}) {
  const [showOccurrences, setShowOccurrences] = useState(false);

  if (!hasRecurrence) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-4">
      {children}
      
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowOccurrences(!showOccurrences)}
          className="mb-3"
        >
          {showOccurrences ? (
            <>
              <ChevronUp className="size-4" />
              <span className="ml-1.5">Hide occurrences</span>
            </>
          ) : (
            <>
              <ChevronDown className="size-4" />
              <span className="ml-1.5">View occurrences</span>
            </>
          )}
        </Button>

        {showOccurrences && (
          <OccurrencesManager announcementId={announcementId} title={title} />
        )}
      </div>
    </div>
  );
}
