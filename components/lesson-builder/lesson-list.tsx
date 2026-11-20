import Link from "next/link";
import { GraduationCap, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import type { SermonListItem } from "@/lib/queries/sermons";
import { formatSermonDate } from "@/lib/sermon-builder/sermon-display";

function dateParts(date: string | null): { month: string; day: string } | null {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    month: parsed.toLocaleDateString(undefined, { month: "short" }),
    day: String(parsed.getDate()),
  };
}

/** Where a lesson came from, in a few words; nothing for one made here from a passage. */
function originNote(lesson: SermonListItem, fromRecording: boolean): string | null {
  if (fromRecording) return "From a past sermon";
  if ((lesson.builder ?? "sermon") === "sermon") return "From a sermon";
  return null;
}

/**
 * Big rows: the date, the title, the passages and, when it applies, where the
 * lesson came from. Every row opens the lesson in Lesson Builder.
 */
export function LessonList({
  lessons,
  lessonIdsFromRecordings = [],
}: {
  lessons: SermonListItem[];
  lessonIdsFromRecordings?: string[];
}) {
  if (lessons.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No lessons yet"
        description="Make a lesson from a past sermon, or start a new one from Bible passages."
        action={
          <Button size="lg" nativeButton={false} render={<Link href="/dashboard/lesson-builder/new" />}>
            <Plus aria-hidden className="size-5" />
            New lesson
          </Button>
        }
      />
    );
  }

  const fromRecordings = new Set(lessonIdsFromRecordings);

  return (
    <List label="Lessons">
      {lessons.map((lesson) => {
        const parts = dateParts(lesson.sermon_date);
        const when = formatSermonDate(lesson.sermon_date, "short");
        const scripture = lesson.scripture_refs.filter(Boolean).join(", ");
        const context = [when, scripture || lesson.topic].filter(Boolean).join(" · ");
        const note = originNote(lesson, fromRecordings.has(lesson.id));

        return (
          <ListRow
            key={lesson.id}
            href={`/dashboard/lesson-builder/${lesson.id}`}
            leading={
              <span
                aria-hidden
                className="flex size-14 flex-col items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
              >
                {parts ? (
                  <>
                    <span className="text-sm font-semibold uppercase leading-none">{parts.month}</span>
                    <span className="font-heading text-xl font-bold leading-tight">{parts.day}</span>
                  </>
                ) : (
                  <GraduationCap className="size-6" strokeWidth={1.75} />
                )}
              </span>
            }
            title={lesson.title}
            subtitle={
              context || note ? (
                <>
                  {context}
                  {note && (
                    <span className="block truncate text-sm text-muted-foreground">{note}</span>
                  )}
                </>
              ) : undefined
            }
          />
        );
      })}
    </List>
  );
}
