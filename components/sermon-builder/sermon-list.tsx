"use client";

import Link from "next/link";
import { Smartphone } from "lucide-react";
import { formatDistanceToNow } from "@/lib/format-date";
import { isSermonShared, sermonAudienceLabel } from "@/lib/sermons/v1/share-rules";
import { DeleteDraftButton } from "@/components/sermon-builder/delete-draft-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { SermonListItem } from "@/lib/queries/sermons";

export function SermonList({ sermons }: { sermons: SermonListItem[] }) {
  if (sermons.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
        No sermons yet. Create your first sermon to get started.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {sermons.map((s) => (
        <li key={s.id}>
          <Card className="transition-all hover:border-accent/50 hover:shadow-card-hover">
            <CardContent className="flex items-center justify-between gap-3 p-5">
              <Link
                href={`/dashboard/sermon-builder/${s.id}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-heading text-lg font-semibold">{s.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {s.sermon_date &&
                      `${new Date(`${s.sermon_date}T12:00:00`).toLocaleDateString()} · `}
                    {s.topic}
                    {s.scripture_refs.length > 0 &&
                      ` · ${s.scripture_refs.join(", ")}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex flex-wrap justify-end gap-1">
                    {isSermonShared(s) && (
                      <Badge
                        variant="info"
                        title={`In the FaithForm app: ${sermonAudienceLabel(s.mobile_visibility) ?? ""}`}
                      >
                        <Smartphone className="mr-1 size-3.5" strokeWidth={2} aria-hidden />
                        In the app · {sermonAudienceLabel(s.mobile_visibility, "short")}
                      </Badge>
                    )}
                    {(s.kind ?? "advanced") === "simple" && (
                      <Badge variant="outline">Slides</Badge>
                    )}
                    <Badge
                      variant={
                        s.status === "published" ? "success" : "secondary"
                      }
                    >
                      {s.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(s.updated_at)}
                  </span>
                </div>
              </Link>
              {s.status === "draft" && (
                <DeleteDraftButton sermonId={s.id} sermonTitle={s.title} />
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
