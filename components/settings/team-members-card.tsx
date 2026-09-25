"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  UsersRound,
  HandHeart,
} from "lucide-react";
import { toast } from "sonner";

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
import {
  TEAM_PRESETS,
  defaultPresetId,
  isPresetAvailable,
  matchPreset,
  presetFeatures,
  roleLabel,
  type TeamPresetId,
} from "@/components/settings/team-presets";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InitialsAvatar, List } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getFeature, type FeatureKey } from "@/lib/features/catalog";
import type { TeamMember, TeamRole } from "@/lib/queries/team";
import { cn } from "@/lib/utils";

const initialState: TeamFormState = { ok: false };

const PRESET_ICONS: Record<TeamPresetId, typeof ShieldCheck> = {
  admin: ShieldCheck,
  staff: UsersRound,
  volunteer: HandHeart,
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function toolList(keys: readonly FeatureKey[]): string {
  return keys.map((key) => getFeature(key).label).join(", ");
}

/** "Can open everything" / "Can open Attendance, Kids Check-In". */
function accessSentence(role: TeamRole, features: readonly FeatureKey[]): string {
  if (role === "admin") return "Can open everything";
  if (features.length === 0) return "Can't open anything yet";
  return `Can open ${toolList(features)}`;
}

type RevealedPassword = { email: string; password: string; reason: "invite" | "reset" };

/**
 * The one and only time a temporary password is visible. Supabase stores a
 * hash, so if nobody writes it down the only way back is a fresh one. It sits
 * on the page (not in a dialog a stray click could close) until the admin
 * says they have it.
 */
function TempPasswordPanel({
  revealed,
  onDone,
}: {
  revealed: RevealedPassword;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(revealed.password);
      setCopied(true);
      toast.success("Password copied.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("We couldn't copy it. Select the password and copy it yourself.");
    }
  };

  return (
    <section
      aria-labelledby="temp-password-heading"
      className="flex flex-col gap-4 rounded-2xl border-2 border-amber-400/70 bg-amber-50 p-6 dark:border-amber-400/50 dark:bg-amber-500/10"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
        >
          <AlertTriangle className="size-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 id="temp-password-heading" className="font-heading text-lg font-bold text-foreground">
            Copy this password now. You won&apos;t see it again.
          </h3>
          <p className="text-[15px] leading-relaxed text-foreground/80">
            {revealed.reason === "invite"
              ? `This is the temporary password for ${revealed.email}. Give it to them in person, by phone or by text. They choose their own password the first time they sign in.`
              : `This is the new temporary password for ${revealed.email}. Their old password has stopped working. They choose a new one the first time they sign in.`}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <code
          aria-label="Temporary password"
          className="min-w-0 flex-1 break-all rounded-xl border border-border bg-background px-4 py-3 font-mono text-xl font-bold tracking-wide text-foreground"
        >
          {revealed.password}
        </code>
        <Button type="button" size="lg" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy password"}
        </Button>
      </div>

      <div>
        <Button type="button" variant="outline" onClick={onDone}>
          I&apos;ve saved it
        </Button>
      </div>
    </section>
  );
}

/**
 * Admin / Staff / Volunteer as three big cards, with the tool-by-tool grid
 * one click further down for the churches that want it.
 */
function AccessChooser({
  role,
  features,
  onChange,
  availableFeatures,
  disabled = false,
  idPrefix,
}: {
  role: TeamRole;
  features: FeatureKey[];
  onChange: (next: { role: TeamRole; features: FeatureKey[] }) => void;
  availableFeatures: FeatureKey[];
  disabled?: boolean;
  idPrefix: string;
}) {
  const selectedPreset = matchPreset(role, features, availableFeatures);
  const customEmpty = role === "viewer" && features.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="role" value={role} />

      <fieldset className="flex flex-col gap-3" disabled={disabled}>
        <legend className="mb-3 text-[15px] font-semibold text-foreground">
          What can they do?
        </legend>
        <div className="choice-grid choice-grid-3" role="radiogroup" aria-label="Access">
          {TEAM_PRESETS.map((preset) => {
            const available = isPresetAvailable(preset, availableFeatures);
            const active = selectedPreset === preset.id;
            const Icon = PRESET_ICONS[preset.id];
            const grants = presetFeatures(preset, availableFeatures);
            return (
              <button
                key={preset.id}
                id={`${idPrefix}-preset-${preset.id}`}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled || !available}
                onClick={() => onChange({ role: preset.role, features: grants })}
                className={cn(
                  "flex min-h-[132px] flex-col gap-2 rounded-2xl border-2 p-4 text-left transition-colors motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-accent bg-accent/10 shadow-sm"
                    : "border-border bg-background hover:border-accent/50 hover:bg-accent/5",
                  (disabled || !available) && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-10 items-center justify-center rounded-xl",
                      active ? "bg-accent text-accent-foreground" : "bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent",
                    )}
                  >
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  {active && <Check className="size-5 text-accent" strokeWidth={2.5} aria-hidden />}
                </span>
                <span className="text-base font-bold text-foreground">{preset.label}</span>
                <span className="text-sm leading-snug text-muted-foreground">
                  {!available
                    ? "Not available on your account."
                    : preset.role === "admin"
                      ? preset.description
                      : preset.id === "volunteer"
                        ? preset.description
                        : `${toolList(grants)}.`}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <AdvancedSection
        title="Choose tools one by one"
        description={
          selectedPreset === null && role === "viewer"
            ? "Custom: only the tools ticked below."
            : "For when a preset doesn't fit."
        }
        forceOpen={selectedPreset === null && role === "viewer"}
      >
        {role === "admin" ? (
          <div className="flex flex-col gap-3">
            <AdminAccessNotice />
            <p className="text-sm text-muted-foreground">
              Choose Staff or Volunteer above to pick tools one by one.
            </p>
          </div>
        ) : (
          <FeatureAccessPicker
            availableFeatures={availableFeatures}
            selected={features}
            onChange={(next) => onChange({ role: "viewer", features: next })}
            disabled={disabled}
          />
        )}
      </AdvancedSection>

      {customEmpty && (
        <p className="text-sm font-medium text-destructive" role="alert">
          Tick at least one tool, or choose Staff or Volunteer.
        </p>
      )}
    </div>
  );
}

function SubmitButton({
  label,
  pendingLabel,
  disabled,
}: {
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  availableFeatures,
  onRevealPassword,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableFeatures: FeatureKey[];
  onRevealPassword: (revealed: RevealedPassword) => void;
}) {
  const startPreset = TEAM_PRESETS.find(
    (preset) => preset.id === defaultPresetId(availableFeatures),
  )!;
  const [access, setAccess] = useState<{ role: TeamRole; features: FeatureKey[] }>({
    role: startPreset.role,
    features: presetFeatures(startPreset, availableFeatures),
  });
  const [email, setEmail] = useState("");
  const [state, formAction] = useActionState(inviteTeamMember, initialState);
  const router = useRouter();

  useEffect(() => {
    if (!state.ok) return;
    router.refresh();
    if (state.tempPassword) {
      onRevealPassword({
        email: state.tempPasswordEmail ?? "them",
        password: state.tempPassword,
        reason: "invite",
      });
    }
    toast.success(state.message ?? "Invite sent.");
    setEmail("");
    onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const invalid = access.role === "viewer" && access.features.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Invite someone to your team</DialogTitle>
          <DialogDescription>
            We&apos;ll email them a way to sign in. You can change what they can do at any time.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite_email" className="text-[15px]">
                Their email address
              </Label>
              <Input
                id="invite_email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="off"
              />
            </div>

            <AccessChooser
              idPrefix="invite"
              role={access.role}
              features={access.features}
              onChange={setAccess}
              availableFeatures={availableFeatures}
            />

            {state.error && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton label="Send invite" pendingLabel="Sending invite…" disabled={invalid} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeAccessDialog({
  member,
  availableFeatures,
  open,
  onOpenChange,
  onRevealPassword,
}: {
  member: TeamMember;
  availableFeatures: FeatureKey[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevealPassword: (revealed: RevealedPassword) => void;
}) {
  const name = member.email ?? "this person";
  const [access, setAccess] = useState<{ role: TeamRole; features: FeatureKey[] }>({
    role: member.role,
    features: member.featurePermissions,
  });
  const [updateState, updateAction] = useActionState(updateTeamMemberAccess, initialState);
  const [resetPending, startReset] = useTransition();
  const [resetError, setResetError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!updateState.ok) return;
    toast.success(`Access changed for ${name}.`);
    onOpenChange(false);
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateState]);

  const resetPassword = async () => {
    const ok = await confirmAction({
      title: `Give ${name} a new temporary password?`,
      description:
        "Their current password stops working right away. You'll see the new one once, to pass on to them.",
      confirmLabel: "Make new password",
      destructive: true,
    });
    if (!ok) return;
    setResetError(null);
    startReset(async () => {
      const formData = new FormData();
      formData.set("member_id", member.id);
      try {
        const result = await resetTeamMemberPassword(initialState, formData);
        if (!result.ok || !result.tempPassword) {
          setResetError(result.error ?? "We couldn't make a new password. Please try again.");
          return;
        }
        onRevealPassword({
          email: result.tempPasswordEmail ?? member.email ?? "them",
          password: result.tempPassword,
          reason: "reset",
        });
        onOpenChange(false);
      } catch {
        setResetError("We couldn't make a new password. Please try again.");
      }
    });
  };

  const invalid = access.role === "viewer" && access.features.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Change access</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>

        <form action={updateAction} className="flex min-h-0 flex-col">
          <input type="hidden" name="member_id" value={member.id} />

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
            <AccessChooser
              idPrefix={`member-${member.id}`}
              role={access.role}
              features={access.features}
              onChange={setAccess}
              availableFeatures={availableFeatures}
            />

            <AdvancedSection
              title="Can't sign in?"
              description="Give them a new temporary password."
              forceOpen={Boolean(resetError)}
            >
              <p className="text-[15px] text-muted-foreground">
                Use this if {name} forgot their password. Their old one stops working, and they
                choose a new one the next time they sign in.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={resetPassword}
                disabled={resetPending}
              >
                <KeyRound aria-hidden />
                {resetPending ? "Making a new password…" : "Make a new temporary password"}
              </Button>
              {resetError && (
                <p className="text-sm text-destructive" role="alert">
                  {resetError}
                </p>
              )}
            </AdvancedSection>

            {updateState.error && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
                {updateState.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton label="Save access" pendingLabel="Saving…" disabled={invalid} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({
  member,
  isSelf,
  canManage,
  availableFeatures,
  onRevealPassword,
}: {
  member: TeamMember;
  isSelf: boolean;
  canManage: boolean;
  availableFeatures: FeatureKey[];
  onRevealPassword: (revealed: RevealedPassword) => void;
}) {
  const [open, setOpen] = useState(false);
  const [removing, startRemove] = useTransition();
  const router = useRouter();
  const name = member.email ?? "Unknown email";

  const remove = async () => {
    const ok = await confirmAction({
      title: `Remove ${member.email ?? "this person"} from your team?`,
      description:
        "They lose access to FaithForm for your church right away. Nothing they created is deleted, and you can invite them again later.",
      confirmLabel: "Remove from team",
      destructive: true,
    });
    if (!ok) return;
    startRemove(async () => {
      const formData = new FormData();
      formData.set("member_id", member.id);
      try {
        const result = await removeTeamMember(initialState, formData);
        if (!result.ok) {
          toast.error(result.error ?? "We couldn't remove them. Please try again.");
          return;
        }
        toast.success(`${member.email ?? "They"} no longer have access to your church.`);
        router.refresh();
      } catch {
        toast.error("We couldn't remove them. Please try again.");
      }
    });
  };

  const subtitle = [
    roleLabel(member.role),
    member.hasSignedIn
      ? `Last signed in ${formatRelative(member.lastSignInAt)}`
      : "Hasn't signed in yet",
  ].join(" · ");

  return (
    <li className="flex flex-col gap-3 rounded-2xl px-4 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <InitialsAvatar name={member.email ?? "?"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold text-foreground">{name}</p>
            {isSelf && <StatusBadge tone="neutral">You</StatusBadge>}
            {!member.hasSignedIn && <StatusBadge tone="working">Invited</StatusBadge>}
          </div>
          <p className="mt-0.5 text-[15px] text-muted-foreground">{subtitle}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {accessSentence(member.role, member.featurePermissions)}
          </p>
        </div>
      </div>

      {canManage && !isSelf && (
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <SlidersHorizontal aria-hidden />
            Change access
          </Button>
          <Button type="button" variant="destructive" onClick={remove} disabled={removing}>
            <Trash2 aria-hidden />
            {removing ? "Removing…" : "Remove"}
          </Button>
        </div>
      )}

      {open && (
        <ChangeAccessDialog
          member={member}
          availableFeatures={availableFeatures}
          open={open}
          onOpenChange={setOpen}
          onRevealPassword={onRevealPassword}
        />
      )}
    </li>
  );
}

export type TeamMembersCardProps = {
  isAdmin: boolean;
  members: TeamMember[];
  availableFeatures: FeatureKey[];
  currentUserId: string;
  /**
   * False while grants are living in app_metadata because migration 0043 has
   * not run. Access still works either way; operators see this in the
   * control center, not pastors.
   */
  grantsInProperColumn?: boolean;
};

export function TeamMembersCard({
  isAdmin,
  members,
  availableFeatures,
  currentUserId,
}: TeamMembersCardProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revealed, setRevealed] = useState<RevealedPassword | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Your team"
        description={
          isAdmin
            ? "Everyone who can sign in to FaithForm for your church, and what each person can open."
            : "Everyone who can sign in to FaithForm for your church."
        }
        action={
          isAdmin ? (
            <Button type="button" size="lg" onClick={() => setInviteOpen(true)}>
              <Plus aria-hidden />
              Invite someone
            </Button>
          ) : undefined
        }
      />

      {revealed && <TempPasswordPanel revealed={revealed} onDone={() => setRevealed(null)} />}

      {members.length === 0 ? (
        <EmptyState
          compact
          icon={UserRound}
          title="No one else on your team yet"
          description="Invite staff and volunteers so they can take attendance, check kids in and more."
          action={
            isAdmin ? (
              <Button type="button" onClick={() => setInviteOpen(true)}>
                <Plus aria-hidden />
                Invite someone
              </Button>
            ) : undefined
          }
        />
      ) : (
        <List label="Team members">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isSelf={member.userId === currentUserId}
              canManage={isAdmin}
              availableFeatures={availableFeatures}
              onRevealPassword={setRevealed}
            />
          ))}
        </List>
      )}

      {!isAdmin && (
        <p className="text-[15px] text-muted-foreground">
          Only church admins can invite people or change what they can open.
        </p>
      )}

      {isAdmin && inviteOpen && (
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          availableFeatures={availableFeatures}
          onRevealPassword={setRevealed}
        />
      )}
    </div>
  );
}
