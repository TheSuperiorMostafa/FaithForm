"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  KeyRound,
  MailPlus,
  MoreHorizontal,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  inviteTeamMember,
  removeTeamMember,
  resetTeamMemberPassword,
  updateTeamMemberAccess,
  type TeamFormState,
} from "@/app/dashboard/settings/team-actions";
import {
  AdminAccessNotice,
  FeatureAccessPicker,
} from "@/components/settings/feature-access-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getFeature, type FeatureKey } from "@/lib/features/catalog";
import type { TeamMember, TeamRole } from "@/lib/queries/team";
import { cn } from "@/lib/utils";

const initialState: TeamFormState = { ok: false };

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * The one and only time the temporary password is visible. Supabase stores a
 * hash, so if the admin closes this without passing it on, the way back is a
 * fresh reset — which the panel says out loud.
 */
function TempPasswordPanel({
  email,
  password,
}: {
  email?: string;
  password: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">
          Temporary password{email ? ` for ${email}` : ""}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Share it with them now — it is shown once, and FaithForm asks them to
          pick their own password the first time they sign in.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-base font-bold tracking-wide text-foreground">
          {password}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? (
            <Check className="size-4" strokeWidth={1.75} />
          ) : (
            <Copy className="size-4" strokeWidth={1.75} />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function RoleChooser({
  value,
  onChange,
  disabled,
}: {
  value: TeamRole;
  onChange: (role: TeamRole) => void;
  disabled?: boolean;
}) {
  const options: Array<{ value: TeamRole; label: string; hint: string }> = [
    { value: "viewer", label: "Member", hint: "Only the features you pick" },
    { value: "admin", label: "Admin", hint: "Everything, including settings" },
  ];

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="role" value={value} />
      <Label>Role</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-xl border px-4 py-3 text-left transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "border-accent/60 bg-accent/10 shadow-sm"
                  : "border-border bg-background hover:border-accent/40 hover:bg-accent/5",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <span className="block text-sm font-semibold text-foreground">
                {option.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {option.hint}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AccessSummary({ member }: { member: TeamMember }) {
  if (member.role === "admin") {
    return (
      <Badge variant="info" className="gap-1">
        <ShieldCheck className="size-3.5" strokeWidth={2} aria-hidden />
        Full access
      </Badge>
    );
  }

  if (member.featurePermissions.length === 0) {
    return (
      <Badge variant="muted">No features yet</Badge>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {member.featurePermissions.map((key) => (
        <Badge key={key} variant="outline">
          {getFeature(key).label}
        </Badge>
      ))}
    </div>
  );
}

function InviteMemberDialog({
  availableFeatures,
}: {
  availableFeatures: FeatureKey[];
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<TeamRole>("viewer");
  const [features, setFeatures] = useState<FeatureKey[]>([]);
  const [state, formAction] = useFormState(inviteTeamMember, initialState);
  const router = useRouter();

  // A successful invite that minted a password keeps the dialog open: closing
  // it would take the only copy of that password with it.
  const revealing = state.ok && Boolean(state.tempPassword);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      if (!state.tempPassword) {
        setOpen(false);
        setRole("viewer");
        setFeatures([]);
      }
    }
  }, [state, router]);

  const close = () => {
    setOpen(false);
    setRole("viewer");
    setFeatures([]);
  };

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <MailPlus className="size-4" strokeWidth={1.75} />
        Invite teammate
      </Button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {revealing ? "Teammate added" : "Invite a teammate"}
            </DialogTitle>
            <DialogDescription>
              {revealing
                ? "Pass the temporary password on — they change it when they sign in."
                : "We'll create their FaithForm account with a temporary password and email it to them."}
            </DialogDescription>
          </DialogHeader>

          {revealing ? (
            <>
              <div className="flex flex-col gap-4 px-6 py-5">
                <TempPasswordPanel
                  email={state.tempPasswordEmail}
                  password={state.tempPassword!}
                />
                {state.message && (
                  <p className="text-sm text-muted-foreground">
                    {state.message}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button type="button" onClick={close}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form action={formAction} className="flex min-h-0 flex-col">
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="invite_email">Email address</Label>
                  <Input
                    id="invite_email"
                    name="email"
                    type="email"
                    required
                    placeholder="teammate@yourchurch.org"
                    autoComplete="off"
                  />
                </div>

                <RoleChooser value={role} onChange={setRole} />

                {role === "admin" ? (
                  <AdminAccessNotice />
                ) : (
                  <FeatureAccessPicker
                    availableFeatures={availableFeatures}
                    selected={features}
                    onChange={setFeatures}
                  />
                )}

                {state.error && (
                  <p className="text-sm text-destructive" role="alert">
                    {state.error}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <SubmitButton label="Send invite" pendingLabel="Inviting…" />
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ManageMemberDialog({
  member,
  availableFeatures,
  isSelf,
  open,
  onOpenChange,
}: {
  member: TeamMember;
  availableFeatures: FeatureKey[];
  isSelf: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [role, setRole] = useState<TeamRole>(member.role);
  const [features, setFeatures] = useState<FeatureKey[]>(
    member.featurePermissions,
  );
  const [updateState, updateAction] = useFormState(
    updateTeamMemberAccess,
    initialState,
  );
  const [removeState, removeAction] = useFormState(
    removeTeamMember,
    initialState,
  );
  const [resetState, resetAction] = useFormState(
    resetTeamMemberPassword,
    initialState,
  );
  const router = useRouter();

  useEffect(() => {
    if (updateState.ok || removeState.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }, [updateState, removeState, onOpenChange, router]);

  // A reset deliberately does not close the dialog — the new password is only
  // readable here, and only until this closes.
  useEffect(() => {
    if (resetState.ok) router.refresh();
  }, [resetState, router]);

  // Re-sync when the row changes underneath an open dialog.
  useEffect(() => {
    setRole(member.role);
    setFeatures(member.featurePermissions);
  }, [member.role, member.featurePermissions]);

  const error = updateState.error ?? removeState.error ?? resetState.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage access</DialogTitle>
          <DialogDescription>{member.email ?? member.userId}</DialogDescription>
        </DialogHeader>

        <form action={updateAction} className="flex min-h-0 flex-col">
          <input type="hidden" name="member_id" value={member.id} />

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
            <RoleChooser value={role} onChange={setRole} disabled={isSelf} />

            {isSelf && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                You can&apos;t change your own role. Ask another admin if you
                need it changed.
              </p>
            )}

            {role === "admin" ? (
              <AdminAccessNotice />
            ) : (
              <FeatureAccessPicker
                availableFeatures={availableFeatures}
                selected={features}
                onChange={setFeatures}
                disabled={isSelf}
              />
            )}

            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Sign-in password
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Locked out? Issue a new temporary password. Theirs stops
                    working right away and they pick a new one on sign-in.
                  </p>
                </div>
                <Button
                  type="submit"
                  form={`reset-member-${member.id}`}
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                >
                  <KeyRound className="size-4" strokeWidth={1.75} />
                  New temp password
                </Button>
              </div>
              {resetState.ok && resetState.tempPassword && (
                <TempPasswordPanel
                  email={resetState.tempPasswordEmail ?? member.email ?? undefined}
                  password={resetState.tempPassword}
                />
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              type="submit"
              form={`remove-member-${member.id}`}
              variant="destructive"
              disabled={isSelf}
              className={cn(isSelf && "invisible")}
            >
              <Trash2 className="size-4" strokeWidth={1.75} />
              Remove
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <SubmitButton label="Save access" pendingLabel="Saving…" />
            </div>
          </DialogFooter>
        </form>

        {/* Sibling forms so Remove and the password reset can sit inside the
            access form's layout without nesting a form in a form. */}
        <form id={`remove-member-${member.id}`} action={removeAction} hidden>
          <input type="hidden" name="member_id" value={member.id} />
        </form>
        <form id={`reset-member-${member.id}`} action={resetAction} hidden>
          <input type="hidden" name="member_id" value={member.id} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({
  member,
  availableFeatures,
  currentUserId,
}: {
  member: TeamMember;
  availableFeatures: FeatureKey[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const isSelf = member.userId === currentUserId;

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 transition-colors hover:border-accent/40 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
              member.role === "admin"
                ? "bg-accent text-accent-foreground"
                : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            {(member.email ?? "?").charAt(0).toUpperCase()}
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">
                {member.email ?? "Unknown email"}
              </p>
              {isSelf && <Badge variant="secondary">You</Badge>}
              {!member.hasSignedIn && (
                <Badge variant="warning">Invited</Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {member.role === "admin" ? "Admin" : "Member"} ·{" "}
              {member.hasSignedIn
                ? `Last active ${formatRelative(member.lastSignInAt).toLowerCase()}`
                : "Hasn't signed in yet"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:justify-end">
          <div className="min-w-0 sm:max-w-[18rem]">
            <AccessSummary member={member} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Manage access for ${member.email ?? "this member"}`}
            onClick={() => setOpen(true)}
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      {open && (
        <ManageMemberDialog
          member={member}
          availableFeatures={availableFeatures}
          isSelf={isSelf}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

export type TeamMembersCardProps = {
  isAdmin: boolean;
  members: TeamMember[];
  availableFeatures: FeatureKey[];
  currentUserId: string;
};

export function TeamMembersCard({
  isAdmin,
  members,
  availableFeatures,
  currentUserId,
}: TeamMembersCardProps) {
  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>
            Everyone with access to your church&apos;s FaithForm account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-background p-4"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                {(member.email ?? "?").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {member.email ?? "Unknown email"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {member.role === "admin" ? "Admin" : "Member"}
                </p>
              </div>
            </div>
          ))}
          <p className="pt-2 text-sm text-muted-foreground">
            Only church admins can invite teammates or change access.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Team</CardTitle>
          <CardDescription>
            Invite staff and volunteers, then choose exactly which tools each
            person can open.
          </CardDescription>
        </div>
        <InviteMemberDialog availableFeatures={availableFeatures} />
      </CardHeader>

      <CardContent className="flex flex-col gap-2.5">
        {members.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent">
              <UserRound className="size-6" strokeWidth={1.75} aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">
              No teammates yet. Invite someone to share the load.
            </p>
          </div>
        ) : (
          members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              availableFeatures={availableFeatures}
              currentUserId={currentUserId}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
