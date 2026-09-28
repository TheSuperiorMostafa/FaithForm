import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  ticketId,
  reviewAction,
}: {
  comments: SupportTicketComment[];
  viewer: "platform" | "church";
  emptyLabel?: string;
  ticketId?: string;
  reviewAction?: (formData: FormData) => Promise<void>;
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
                className="text-sm text-muted-foreground"
              >
                {new Date(comment.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[15px] text-foreground">
              {comment.body}
            </p>
            {viewer === "platform" && (comment.notificationEmailStatus === "pending" || comment.notificationEmailStatus === "unconfirmed") && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  {comment.authorRole === "church" ? "Support inbox" : "Church email"} needs review. Check the recipient inbox and follow up if needed.
                </p>
                {reviewAction && ticketId && (
                  <form action={reviewAction}>
                    <input type="hidden" name="kind" value="comment" />
                    <input type="hidden" name="ticketId" value={ticketId} />
                    <input type="hidden" name="commentId" value={comment.id} />
                    <Button type="submit" variant="outline" size="sm">Mark handled</Button>
                  </form>
                )}
              </div>
            )}
            {viewer === "platform" && comment.notificationEmailStatus === "reviewed" && (
              <p className="mt-2 text-xs text-muted-foreground">Email alert manually handled; original delivery remains unknown.</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
