"use client";

import { useState, useTransition } from "react";
import { Archive, Mail, MailOpen } from "lucide-react";
import { toast } from "sonner";

import { setSubmissionStatus } from "@/app/dashboard/website/actions";
import { Button } from "@/components/ui/button";
import type { ContactSubmissionRow } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

type Filter = "new" | "read" | "archived";

export function SubmissionsInbox({ items }: { items: ContactSubmissionRow[] }) {
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
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, status } : row)),
    );

    startTransition(async () => {
      const result = await setSubmissionStatus(id, status);
      if (!result.ok) {
        setRows(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Messages sent through the contact form on your website. Each one is also
        emailed to your church, with the sender set as the reply-to address.
      </p>

      <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
        {(["new", "read", "archived"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-selected={filter === key}
            className={cn(
              "inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold capitalize transition-colors",
              filter === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {key}
            <span className="rounded-full bg-muted px-1.5 text-xs">
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {filter === "new"
            ? "No new messages. Anything visitors send will land here."
            : `Nothing ${filter}.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-heading text-base font-bold">{row.name}</div>
                  <div className="text-xs text-muted-foreground">
                    <a
                      href={`mailto:${row.email}`}
                      className="underline underline-offset-2"
                    >
                      {row.email}
                    </a>
                    {row.phone ? ` · ${row.phone}` : ""}
                    {" · "}
                    {new Date(row.createdAt).toLocaleString()}
                  </div>
                </div>

                <div className="flex gap-1">
                  {row.status !== "read" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => update(row.id, "read")}
                    >
                      <MailOpen className="mr-1 size-4" /> Mark read
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => update(row.id, "new")}
                    >
                      <Mail className="mr-1 size-4" /> Mark unread
                    </Button>
                  )}
                  {row.status !== "archived" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => update(row.id, "archived")}
                    >
                      <Archive className="mr-1 size-4" /> Archive
                    </Button>
                  ) : null}
                </div>
              </div>

              {row.message ? (
                <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm leading-relaxed">
                  {row.message}
                </p>
              ) : null}

              {!row.emailedAt ? (
                <p className="text-xs text-muted-foreground">
                  Stored, but the email notification did not send. The message
                  itself is safe.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
