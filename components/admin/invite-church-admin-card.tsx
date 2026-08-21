"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { inviteChurchAdmin } from "@/app/admin/actions";
import { resendInvite } from "@/app/onboarding/actions";
import { formatDate } from "@/components/admin/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminChurchInvite } from "@/lib/queries/admin";
import { cn } from "@/lib/utils";

const inputClass = cn(
  "min-h-11 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-sm outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

/**
 * Hands a church over to its own admin.
 *
 * Shown while nobody at the church has an account yet — either because we
 * created the workspace ahead of knowing the pastor's address, or because the
 * invite we sent has not been accepted.
 */
export function InviteChurchAdminCard({
  churchId,
  pendingInvite,
}: {
  churchId: string;
  pendingInvite: AdminChurchInvite | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!pendingInvite);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    formData.set("churchId", churchId);

    startTransition(async () => {
      const result = await inviteChurchAdmin(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Invite sent to ${result.email}`);
      setEditing(false);
      router.refresh();
    });
  }

  function handleResend() {
    setError(null);
    startTransition(async () => {
      const result = await resendInvite(churchId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Invite sent again to ${result.email}`);
      router.refresh();
    });
  }

  return (
    <Card className="border-accent/40 bg-accent/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-5 text-accent" strokeWidth={1.75} />
          {pendingInvite ? "Waiting on their admin" : "No church admin yet"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {pendingInvite
            ? `Invited ${pendingInvite.email} on ${formatDate(pendingInvite.createdAt)} — the link works until ${formatDate(pendingInvite.expiresAt)}.`
            : "Nobody at this church can sign in yet. Everything here is still ours to set up; send the invite once you have the right address."}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pendingInvite && !editing ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={handleResend}
            >
              <Mail className="size-4" strokeWidth={1.75} />
              {pending ? "Sending…" : "Send it again"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(true)}>
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inviteFirstName">Admin first name</Label>
                <Input
                  id="inviteFirstName"
                  name="adminFirstName"
                  defaultValue={pendingInvite?.adminFirstName ?? ""}
                  placeholder="Jane"
                  required
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inviteLastName">Admin last name</Label>
                <Input
                  id="inviteLastName"
                  name="adminLastName"
                  defaultValue={pendingInvite?.adminLastName ?? ""}
                  placeholder="Smith"
                  required
                  className={inputClass}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="inviteEmail">Admin email</Label>
                <Input
                  id="inviteEmail"
                  name="adminEmail"
                  type="email"
                  defaultValue={pendingInvite?.email ?? ""}
                  placeholder="pastor@example.com"
                  required
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                <Mail className="size-4" strokeWidth={1.75} />
                {pending ? "Sending…" : "Send invite"}
              </Button>
              {pendingInvite && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
