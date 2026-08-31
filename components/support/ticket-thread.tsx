import { cn } from "@/lib/utils";
import type { SupportTicketComment } from "@/lib/support/comments";

/**
 * One support ticket's conversation, rendered the same on both sides.
 *
 * `viewer` only decides which side is "us" — the content is identical, so a
 * church and a platform admin are always looking at the same thread and can
 * never be shown different answers to the same question.
 */
export function TicketThread({
  comments,
  viewer,
  emptyLabel,
}: {
  comments: SupportTicketComment[];
  viewer: "platform" | "church";
  emptyLabel?: string;
}) {
  if (comments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyLabel ?? "No replies yet."}
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {comments.map((comment) => {
        const mine = comment.authorRole === viewer;
        return (
          <li
            key={comment.id}
            className={cn(
              "rounded-xl border px-4 py-3",
              mine
                ? "border-border bg-muted/40"
                : "border-accent/30 bg-accent/5",
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                {comment.authorRole === "platform"
                  ? "FaithForm Support"
                  : (comment.authorName ?? "Your church")}
              </p>
              <time
                dateTime={comment.createdAt}
                className="text-xs text-muted-foreground"
              >
                {new Date(comment.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
              {comment.body}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
