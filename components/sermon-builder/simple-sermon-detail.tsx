"use client";

import Link from "next/link";
import { Download, Pencil, Presentation } from "lucide-react";
import { DeleteDraftButton } from "@/components/sermon-builder/delete-draft-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SlideTheme } from "@/lib/sermon-builder/slide-theme-shared";
import { getTheme } from "@/lib/sermon-builder/themes";
import type { Sermon } from "@/types/sermon";

type SimpleSermonDetailProps = {
  sermon: Sermon;
  theme?: SlideTheme | null;
};

export function SimpleSermonDetail({ sermon, theme: themeProp }: SimpleSermonDetailProps) {
  const theme = themeProp ?? getTheme(sermon.theme_id);
  const refsSummary =
    sermon.scripture_refs.length > 0
      ? sermon.scripture_refs.join(" · ")
      : "";
  const formattedDate = sermon.sermon_date
    ? new Date(`${sermon.sermon_date}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">{sermon.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formattedDate && <span>{formattedDate}</span>}
            {formattedDate && refsSummary && " · "}
            {refsSummary}
            {sermon.translation && (formattedDate || refsSummary) && ` · ${sermon.translation}`}
            {!formattedDate && !refsSummary && sermon.translation}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline">Slide deck</Badge>
            <Badge variant="secondary">{theme.name}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            render={
              <Link href={`/dashboard/sermon-builder/${sermon.id}/edit`}>
                <Pencil className="size-4" strokeWidth={1.75} />
                Edit deck
              </Link>
            }
          />
          {sermon.status === "draft" && (
            <DeleteDraftButton
              sermonId={sermon.id}
              sermonTitle={sermon.title}
              variant="outline"
              redirectTo="/dashboard/sermon-builder"
            />
          )}
          <Button
            size="lg"
            nativeButton={false}
            render={
              <a href={`/api/sermon/${sermon.id}/export/pptx`} download>
                <Download className="size-4" strokeWidth={1.75} />
                Download PowerPoint
              </a>
            }
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Presentation className="size-6 text-accent" strokeWidth={1.75} />
            Theme: {theme.name}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{theme.description}</p>
        </CardHeader>
        <CardContent>
          <div
            className="overflow-hidden rounded-xl border border-border"
            style={
              theme.backgroundType === "image" && theme.imageUrl
                ? {
                    backgroundImage: `url(${theme.imageUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : { background: theme.bgCss }
            }
          >
            {theme.backgroundType === "image" && theme.textShadow && (
              <div className="bg-black/25">
                <div className="p-6 text-center">
                  <p
                    className="text-sm font-medium drop-shadow-md"
                    style={{ color: `#${theme.accent}` }}
                  >
                    {refsSummary || "Scripture slides"}
                  </p>
                  <p
                    className="mt-2 text-lg drop-shadow-md"
                    style={{ color: `#${theme.text}`, fontFamily: theme.fontBody }}
                  >
                    Scripture slides — download to view all verses
                  </p>
                </div>
              </div>
            )}
            {theme.backgroundType !== "image" && (
              <div className="p-6 text-center">
                <p
                  className="text-sm font-medium"
                  style={{ color: `#${theme.accent}` }}
                >
                  {refsSummary || "Scripture slides"}
                </p>
                <p
                  className="mt-2 text-lg"
                  style={{ color: `#${theme.text}`, fontFamily: theme.fontBody }}
                >
                  Scripture slides — download to view all verses
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scripture</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {sermon.scripture_refs.map((r) => (
            <Badge key={r} variant="outline">
              {r}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        <Link
          href="/dashboard/sermon-builder/new"
          className="text-primary underline-offset-4 hover:text-accent hover:underline"
        >
          Create another slide deck
        </Link>
        {" · "}
        <Link
          href="/dashboard/settings"
          className="text-primary underline-offset-4 hover:text-accent hover:underline"
        >
          Switch to Advanced mode in Settings
        </Link>
      </p>
    </div>
  );
}
