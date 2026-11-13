"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, Loader2, Mail, MailOpen, Reply } from "lucide-react";
import { toast } from "sonner";
import { inboxRefreshNeedsCursorReset, mergeInboxMessages, rollbackInboxStatus } from "./inbox-state";
import { websiteActionRequest } from "./action-request";

import { loadOlderContactSubmissions, setSubmissionStatus } from "@/app/dashboard/website/actions";
import { replyMailto } from "@/components/website-admin/website-words";
import { Button, buttonVariants } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page-header";
import type { ContactSubmissionCursor, ContactSubmissionRow } from "@/lib/sites/queries";
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
  nextCursor = null,
}: {
  items: ContactSubmissionRow[];
  churchName?: string | null;
  nextCursor?: ContactSubmissionCursor | null;
}) {
  const [rows, setRows] = useState(items);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [cursor, setCursor] = useState(nextCursor);
  const loadedOlder = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const localStatuses = useRef(new Map<string, { status: Filter; committed: boolean }>());
  const overrides = () => new Map([...localStatuses.current].map(([id, edit]) => [id, edit.status]));
  useEffect(() => {
    for (const row of items) {
      const edit = localStatuses.current.get(row.id);
      if (edit?.committed && edit.status === row.status) localStatuses.current.delete(row.id);
    }
    if (!loadedOlder.current || inboxRefreshNeedsCursorReset(rowsRef.current, items)) setCursor(nextCursor);
    const activeStatuses = overrides();
    setRows(current => mergeInboxMessages(current, items, "refresh", activeStatuses));
  }, [items, nextCursor]);
  const [filter, setFilter] = useState<Filter>("new");
  const [pending, startTransition] = useTransition();
  const [undoPending, setUndoPending] = useState(false);
  const changing = useRef(false);
  const busy = pending || undoPending;

  async function showOlder() {
    if (loadingOlderRef.current || !cursor) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setLoadError(null);
    try {
      const result = await websiteActionRequest(() => loadOlderContactSubmissions({ cursor }));
      if (!result.ok) { setLoadError(result.error); return; }
      const activeStatuses = overrides();
      setRows(current => mergeInboxMessages(current, result.items, "older", activeStatuses));
      loadedOlder.current = true;
      setCursor(current => current?.id === cursor.id && current.createdAt === cursor.createdAt ? result.nextCursor : current);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  const visible = rows.filter((row) => row.status === filter);
  const counts = {
    new: rows.filter((r) => r.status === "new").length,
    read: rows.filter((r) => r.status === "read").length,
    archived: rows.filter((r) => r.status === "archived").length,
  };

  function update(id: string, status: Filter) {
    if (changing.current) return;
    changing.current = true;
    const name = rows.find((row) => row.id === id)?.name?.trim();
    const what = name ? `${name}'s message` : "The message";
    const before = rows.find((row) => row.id === id)?.status ?? "new";
    localStatuses.current.set(id, { status, committed: false });
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, status } : row)),
    );

    startTransition(async () => {
      const result = await websiteActionRequest(() => setSubmissionStatus(id, status));
      changing.current = false;
      if (!result.ok) {
        // Keep changes to other messages, including a successful Undo, intact.
        localStatuses.current.delete(id);
        setRows(current => rollbackInboxStatus(current, id, status, before));
        toast.error(result.error);
        return;
      }
      localStatuses.current.set(id, { status, committed: true });
      setRows(current => current.map(row => row.id === id ? { ...row, status } : row));
      if (status === "archived") {
        undoToast(
          `${what} moved to Archived.`,
          async () => {
            if (changing.current) return "Another message is updating. Wait a moment, then try Undo again.";
            changing.current = true;
            setUndoPending(true);
            const undoFrom = rowsRef.current.find(row => row.id === id)?.status ?? "archived";
            localStatuses.current.set(id, { status: before, committed: false });
            setRows(current => current.map(row => row.id === id ? { ...row, status: before } : row));
            try {
              const undone = await websiteActionRequest(() => setSubmissionStatus(id, before));
              if (!undone.ok) {
                localStatuses.current.delete(id);
                setRows(current => rollbackInboxStatus(current, id, before, undoFrom));
                return undone.error;
              }
              localStatuses.current.set(id, { status: before, committed: true });
              setRows(current => current.map(row => row.id === id ? { ...row, status: before } : row));
            } finally {
              changing.current = false;
              setUndoPending(false);
            }
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
        description="Messages visitors send through your website. Read and reply to them here."
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
            {cursor ? `No ${FILTER_LABEL[filter].toLowerCase()} messages loaded yet` : filter === "new"
              ? "No new messages"
              : filter === "read"
                ? "No read messages"
                : "Nothing archived"}
          </p>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {cursor ? "Show older messages to check earlier messages in your inbox." : filter === "new"
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
                      disabled={busy}
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
                          disabled={busy}
                          onClick={() => update(row.id, "read")}
                        >
                          <MailOpen className="size-4" aria-hidden /> Mark as read
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => update(row.id, "new")}
                        >
                          <Mail className="size-4" aria-hidden /> Mark as new
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
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

      <div className="flex flex-wrap items-center gap-3">
        {cursor ? <Button type="button" variant="outline" disabled={loadingOlder} onClick={() => void showOlder()}>
          {loadingOlder ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {loadingOlder ? "Loading older messages…" : "Show older messages"}
        </Button> : null}
        <p className="text-sm text-muted-foreground" role="status">
          {cursor ? `${rows.length} messages loaded. The counts above include these messages.` : `All ${rows.length} messages are loaded.`}
        </p>
      </div>
      {loadError ? <p role="alert" className="text-sm text-destructive">{loadError} Choose Show older messages to try again.</p> : null}
    </div>
  );
}
