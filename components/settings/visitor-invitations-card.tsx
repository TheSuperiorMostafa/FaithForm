"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createVisitorInvitation,
  withdrawVisitorInvitation,
} from "@/app/dashboard/settings/faithful-actions";
import type { InvitationSummary } from "@/lib/faithful/invitations";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const inputClass = cn(
  "min-h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring",
);

const EXPIRY_OPTIONS = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
];

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusOf(invitation: InvitationSummary): "active" | "used up" | "expired" | "withdrawn" {
  if (invitation.revokedAt) return "withdrawn";
  if (invitation.usedCount >= invitation.maxUses) return "used up";
  if (new Date(invitation.expiresAt).getTime() < Date.now()) return "expired";
  return "active";
}

/**
 * Invitations into the visitor app.
 *
 * The link appears exactly once, at creation — only its hash is stored, so
 * reopening this page can never show it again. An invitation admits someone
 * as a member in the app and nothing more: it is structurally incapable of
 * granting dashboard access.
 */
export function VisitorInvitationsCard({
  isAdmin,
  invitations,
}: {
  isAdmin: boolean;
  invitations: InvitationSummary[];
}) {
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [maxUses, setMaxUses] = useState(1);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);

  const create = () => {
    startTransition(async () => {
      const result = await createVisitorInvitation({
        purpose: "join",
        invitedLabel: label.trim() || undefined,
        expiresInDays,
        maxUses,
      });
      if (result.ok) {
        setIssuedUrl(result.data.url);
        setLabel("");
        toast.success("Invitation created.");
      } else {
        toast.error(result.message);
      }
    });
  };

  const copyIssued = async () => {
    if (!issuedUrl) return;
    try {
      await navigator.clipboard.writeText(issuedUrl);
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy — select the link and copy it by hand.");
    }
  };

  const withdraw = (invitationId: string) => {
    startTransition(async () => {
      const result = await withdrawVisitorInvitation(invitationId);
      if (result.ok) toast.success("Invitation withdrawn.");
      else toast.error(result.message);
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">App invitations</CardTitle>
        <CardDescription>
          Send someone a link that joins them to your church in the app —
          including when joining is set to invitation only. An invitation never
          grants access to this dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isAdmin && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invitation-label">Note to yourself (optional)</Label>
                <input
                  id="invitation-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  maxLength={120}
                  placeholder="Fall newcomers class"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invitation-expiry">Expires</Label>
                <select
                  id="invitation-expiry"
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                  className={inputClass}
                >
                  {EXPIRY_OPTIONS.map((option) => (
                    <option key={option.days} value={option.days}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invitation-uses">Uses</Label>
                <input
                  id="invitation-uses"
                  type="number"
                  min={1}
                  max={500}
                  value={maxUses}
                  onChange={(event) =>
                    setMaxUses(
                      Math.max(1, Math.min(500, Number(event.target.value) || 1)),
                    )
                  }
                  className={cn(inputClass, "w-24")}
                />
              </div>
            </div>

            <Button onClick={create} disabled={pending} className="self-start">
              {pending ? "Creating…" : "Create invitation link"}
            </Button>

            {issuedUrl && (
              <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3">
                <p className="text-xs font-semibold text-foreground">
                  Copy this now — it is shown only once.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-background px-2 py-1 text-xs text-foreground">
                    {issuedUrl}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyIssued}>
                    Copy link
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  In the app, tapping the link — or pasting it under “I Have an
                  Invitation” — joins the person to your church.
                </p>
              </div>
            )}
          </div>
        )}

        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No invitations yet. Anyone you invite appears here with how many
            times the link was used.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {invitations.map((invitation) => {
              const status = statusOf(invitation);
              return (
                <div
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-4 py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {invitation.invitedLabel ??
                        invitation.invitedEmail ??
                        "Join invitation"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Used {invitation.usedCount} of {invitation.maxUses} ·{" "}
                      {status === "expired" || status === "withdrawn"
                        ? `Expired ${formatDate(invitation.expiresAt)}`
                        : `Expires ${formatDate(invitation.expiresAt)}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        status === "active"
                          ? "bg-accent/15 text-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {status}
                    </span>
                    {isAdmin && status === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => withdraw(invitation.id)}
                      >
                        Withdraw
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
