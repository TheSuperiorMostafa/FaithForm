"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Mail, MailOpen, Reply } from "lucide-react";
import { toast } from "sonner";

import { setSubmissionStatus } from "@/app/dashboard/website/actions";
import { replyMailto } from "@/components/website-admin/website-words";
import { Button, buttonVariants } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page-header";
import type { ContactSubmissionRow } from "@/lib/sites/queries";
import { undoToast } from "@/lib/ui/undo-toast";
import { cn } from "@/lib/utils";

type Filter = "new" | "read" | "archived";

const FILTER_LABEL: Record<Filter, string> = {
  new: "New",
  read: "Read",
  archived: "Archived",
};

export function SubmissionsInbox({
  items,
  churchName = null,
}: {
  items: ContactSubmissionRow[];
  churchName?: string | null;
}) {
  const [rows, setRows] = useState(items);
  const [filter, setFilter] = useState<Filter>("new");
  const [pending, startTransition] = useTransition();

  const visible = rows.filter((row) => row.status === filter);
  const counts = {
    new: rows.filter((r) => r.status === "new").length,
    read: rows.filter((r) => r.status === "read").length,
    archived: rows.filter((r) => r.status === "archived").length,
  };

  function update(id: string, status: Filter) {
    const previous = rows;
    const name = rows.find((row) => row.id === id)?.name?.trim();
    const what = name ? `${name}'s message` : "The message";
    const before = rows.find((row) => row.id === id)?.status ?? "new";
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, status } : row)),
    );

    startTransition(async () => {
      const result = await setSubmissionStatus(id, status);
      if (!result.ok) {
        setRows(previous);
        toast.error(result.error);
        return;
      }
      if (status === "archived") {
        undoToast(
          `${what} moved to Archived.`,
          async () => {
            const undone = await setSubmissionStatus(id, before);
            if (!undone.ok) return undone.error;
            setRows((current) =>
              current.map((row) => (row.id === id ? { ...row, status: before } : row)),
            );
          },
          { undoneMessage: `${what} is back.` },
        );
        return;
      }
      toast.success(
        status === "read"
            ? `${what} marked as read.`
            : `${what} moved back to New.`,
      );
    });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader
        title="Inbox"
        description="Messages visitors send through the contact form on your website. Each one is also emailed to your church."
      />

      <div
        className="flex w-full max-w-xl gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-sm"
        role="group"
        aria-label="Show messages"
      >
        {(["new", "read", "archived"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-colors",
              filter === key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground/75 hover:bg-muted hover:text-foreground",
            )}
          >
            {FILTER_LABEL[key]}
            <span
              className={cn(
                "rounded-full px-2 text-sm tabular-nums",
                filter === key ? "bg-white/15" : "bg-muted",
              )}
            >
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
          <p className="font-heading text-lg font-bold">
            {filter === "new"
              ? "No new messages"
              : filter === "read"
                ? "No read messages"
                : "Nothing archived"}
          </p>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {filter === "new"
              ? "Anything visitors send through your website lands here."
              : "Messages you move here will show up in this list."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-heading text-base font-bold">{row.name}</div>
                  <div className="text-[15px] text-muted-foreground">
                    <a
                      href={`mailto:${row.email}`}
                      className="text-foreground underline underline-offset-2"
                    >
                      {row.email}
                    </a>
                    {row.phone ? (
                      <>
                        {" · "}
                        <a href={`tel:${row.phone}`} className="underline underline-offset-2">
                          {row.phone}
                        </a>
                      </>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={replyMailto({ email: row.email, name: row.name, churchName })}
                    className={buttonVariants({ variant: "default" })}
                    onClick={() => {
                      if (row.status === "new") update(row.id, "read");
                    }}
                  >
                    <Reply className="size-4" aria-hidden /> Reply
                  </a>
                  {row.status === "archived" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => update(row.id, "read")}
                    >
                      <ArchiveRestore className="size-4" aria-hidden /> Move out of Archived
                    </Button>
                  ) : (
                    <>
                      {row.status === "new" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => update(row.id, "read")}
                        >
                          <MailOpen className="size-4" aria-hidden /> Mark as read
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => update(row.id, "new")}
                        >
                          <Mail className="size-4" aria-hidden /> Mark as new
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => update(row.id, "archived")}
                      >
                        <Archive className="size-4" aria-hidden /> Archive
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {row.message ? (
                <p className="whitespace-pre-wrap rounded-xl bg-muted/40 p-4 text-base leading-relaxed">
                  {row.message}
                </p>
              ) : null}

              {!row.emailedAt ? (
                <p className="text-sm text-muted-foreground">
                  We couldn&apos;t email this one to your church, but the message
                  itself is safe here.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
