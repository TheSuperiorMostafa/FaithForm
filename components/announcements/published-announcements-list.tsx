"use client";

import { useState } from "react";
import { ChevronDown, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatDateTimeRange,
  type AnnouncementRow,
} from "@/lib/queries/announcements";
import { cn } from "@/lib/utils";

type PublishedAnnouncementsListProps = {
  published: AnnouncementRow[];
};

export function PublishedAnnouncementsList({
  published,
}: PublishedAnnouncementsListProps) {
  const [showPublished, setShowPublished] = useState(false);

  if (published.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        className="flex items-center gap-2 text-left font-heading text-lg font-semibold text-foreground hover:text-accent"
        onClick={() => setShowPublished((v) => !v)}
      >
        <ChevronDown
          className={cn(
            "size-5 transition-transform",
            showPublished && "rotate-180",
          )}
        />
        Submitted ({published.length})
      </button>
      {showPublished &&
        published.map((item) => (
          <Card key={item.id}>
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                  <p className="font-semibold">{item.title}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTimeRange(item.start_at, item.end_at, null, item.all_day)}
                </p>
                {item.last_publish_error && (
                  <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {item.last_publish_error}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {item.facebook_post_id && (
                  <a
                    href={`https://www.facebook.com/${item.facebook_post_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm">
                      View on Facebook
                    </Button>
                  </a>
                )}
                <a
                  href="https://mail.google.com/mail/u/0/#drafts"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="sm">
                    <Mail className="size-4" strokeWidth={1.75} />
                    Gmail drafts
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
    </section>
  );
}
