"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Home, Smartphone, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";

import {
  createMember,
  deactivateMember,
  reactivateMember,
  updateMember,
} from "@/app/dashboard/people/actions";
import { moveAppConnectionToPerson } from "@/app/dashboard/people/claim-actions";
import { ProfileAvatar } from "@/components/dashboard/profile-avatar";
import { ContactActions } from "@/components/people/contact-actions";
import {
  MemberCareSection,
  MemberDocumentsSection,
  MemberHouseholdSection,
  useMemberCareDetails,
} from "@/components/people/member-care-panel";
import {
  formatFriendlyDate,
  fullName,
  getInitials,
} from "@/components/people/people-format";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { PhoneInput } from "@/components/ui/phone-input";
import { SearchPicker } from "@/components/ui/search-picker";
import { StatusBadge } from "@/components/ui/status-badge";
import { SuccessState } from "@/components/ui/success-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ChurchMember } from "@/lib/queries/members";
import { formatPhoneDisplay } from "@/lib/people/validate-member";

type MemberFormPanelProps = {
  member?: ChurchMember | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (member: ChurchMember) => void;
  onDeactivated?: (memberId: string) => void;
  onReactivated?: (member: ChurchMember) => void;
  /** This person was added a moment ago: offer the next steps. */
  justAdded?: boolean;
  /** Start a fresh "Add person" form. */
  onAddAnother?: () => void;
  /** The church offers the member app, so say whether this person is on it. */
  showAppStatus?: boolean;
  /** Set when this person is connected to an app account. */
  appConnection?: { linkedAt: string } | null;
  /** The photo to show for this person, larger than the list's. */
  photoUrl?: string | null;
  /** Who an app connection could be moved to: active, and not on the app. */
  moveTargets?: ChurchMember[];
  onAppConnectionMoved?: () => void;
};

type PanelTab = "details" | "care" | "documents" | "household";

/**
 * Whether this person is on the app, and — for when the automatic match got
 * it wrong — moving the connection to the person it should have been.
 */
function MemberAppSection({
  member,
  connection,
  isAdmin,
  moveTargets,
  onMoved,
}: {
  member: ChurchMember;
  connection: { linkedAt: string } | null;
  isAdmin: boolean;
  moveTargets: ChurchMember[];
  onMoved?: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  if (!connection) {
    return (
      <section className="flex items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1 text-[15px]">
          <p className="font-semibold text-foreground">Not on the app yet</p>
          <p className="text-muted-foreground">
            When {member.first_name} joins your church in the app, they&apos;re
            connected here and their check-ins count automatically.{" "}
            <Link href="/dashboard/app" className="font-semibold text-primary underline-offset-4 hover:underline dark:text-accent">
              Share an invitation link
            </Link>
          </p>
        </div>
      </section>
    );
  }

  const chosenId = target[0] ?? "";
  const chosen = moveTargets.find((candidate) => candidate.id === chosenId) ?? null;

  const move = () => {
    if (!chosenId) {
      toast.error("Choose who this app account belongs to.");
      return;
    }
    startTransition(async () => {
      const result = await moveAppConnectionToPerson({
        fromMemberId: member.id,
        toMemberId: chosenId,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        chosen
          ? `The app account now belongs to ${fullName(chosen)}.`
          : "The app account was moved.",
      );
      onMoved?.();
    });
  };

  const since = formatFriendlyDate(connection.linkedAt);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/[0.04] p-4 dark:border-accent/30 dark:bg-accent/10">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-primary dark:text-accent" aria-hidden />
        <div className="flex flex-col gap-1 text-[15px]">
          <p className="font-semibold text-foreground">
            On the app{since ? ` since ${since}` : ""}
          </p>
          <p className="text-muted-foreground">
            When {member.first_name} checks in with the app, it counts as
            their attendance.
            {member.source === "app"
              ? " This record was added when they joined in the app."
              : ""}
          </p>
        </div>
      </div>

      {isAdmin ? (
        moving ? (
          <div className="flex flex-col gap-3">
            <SearchPicker
              label="Which person is this app account?"
              items={moveTargets.map((candidate) => ({
                id: candidate.id,
                label: fullName(candidate),
                description: candidate.phone
                  ? formatPhoneDisplay(candidate.phone) ?? undefined
                  : candidate.email ?? undefined,
              }))}
              value={target}
              onChange={setTarget}
              placeholder="Start typing their name…"
            />
            <p className="text-sm text-muted-foreground">
              {member.source === "app"
                ? `Their check-ins move with it, and this record is deactivated. It only existed for this app account.`
                : `Check-ins already recorded stay with ${member.first_name}. New ones go to the person you choose.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending || !chosenId} onClick={move}>
                {pending
                  ? "Moving…"
                  : chosen
                    ? `Move to ${fullName(chosen)}`
                    : "Move app account"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setMoving(false);
                  setTarget([]);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() => setMoving(true)}
          >
            Wrong person? Move this app account
          </Button>
        )
      ) : null}
    </section>
  );
}

const inputClassName =
  "min-h-12 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 read-only:bg-muted/40";

/**
 * One person.
 *
 * The title is their name. Under it: Call, Text and Email, when those exist.
 * Then four tabs — Details, Care, Documents, Family — each with a button that
 * says exactly what it saves, so nobody wonders whether "Save" on one tab
 * also saved the other.
 */
export function MemberFormPanel({
  member,
  isAdmin,
  onClose,
  onSaved,
  onDeactivated,
  onReactivated,
  justAdded = false,
  onAddAnother,
  showAppStatus = false,
  appConnection = null,
  photoUrl = null,
  moveTargets = [],
  onAppConnectionMoved,
}: MemberFormPanelProps) {
  const isEdit = Boolean(member);
  const readOnly = !isAdmin;

  const [firstName, setFirstName] = useState(member?.first_name ?? "");
  const [lastName, setLastName] = useState(member?.last_name ?? "");
  const [phone, setPhone] = useState(
    member?.phone ? (formatPhoneDisplay(member.phone) ?? member.phone) : "",
  );
  const [email, setEmail] = useState(member?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>("details");

  const [isSaving, startSaveTransition] = useTransition();
  const [isDeactivating, startDeactivateTransition] = useTransition();
  const [isReactivating, startReactivateTransition] = useTransition();

  const care = useMemberCareDetails(isEdit && member ? member.id : null);

  function handleSave() {
    setError(null);

    startSaveTransition(async () => {
      const payload = {
        firstName,
        lastName,
        phone: phone || undefined,
        email: email || undefined,
      };

      const result = isEdit && member
        ? await updateMember({ memberId: member.id, ...payload })
        : await createMember(payload);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      const name = fullName(result.member);
      toast.success(isEdit ? `${name}'s details saved.` : `${name} added.`);
      onSaved(result.member);
    });
  }

  async function handleDeactivate() {
    if (!member) return;
    setError(null);
    const name = fullName(member);

    const confirmed = await confirmAction({
      title: `Deactivate ${name}?`,
      description: `${member.first_name} moves to your Inactive list and off the weekly attendance sheet. Their attendance history, family and documents are all kept, and you can reactivate them at any time.`,
      confirmLabel: `Deactivate ${member.first_name}`,
      cancelLabel: "Keep active",
      destructive: true,
    });
    if (!confirmed) return;

    startDeactivateTransition(async () => {
      const result = await deactivateMember(member.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.success(`${name} deactivated. Their history is kept.`);
      onDeactivated?.(member.id);
      onClose();
    });
  }

  function handleReactivate() {
    if (!member) return;
    setError(null);

    startReactivateTransition(async () => {
      const result = await reactivateMember(member.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.success(`${fullName(member)} is active again.`);
      onReactivated?.(result.member);
    });
  }

  const detailsForm = (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly) handleSave();
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="member-first-name" className="text-base font-semibold">
            First name
          </label>
          <input
            id="member-first-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
            readOnly={readOnly}
            autoFocus={!isEdit}
            autoComplete="off"
            className={inputClassName}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="member-last-name" className="text-base font-semibold">
            Last name (optional)
          </label>
          <input
            id="member-last-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            readOnly={readOnly}
            autoComplete="off"
            className={inputClassName}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="member-phone" className="text-base font-semibold">
          Phone (optional)
        </label>
        <PhoneInput
          id="member-phone"
          value={phone}
          onValueChange={setPhone}
          readOnly={readOnly}
          aria-describedby={readOnly ? undefined : "member-phone-hint"}
          className={inputClassName}
        />
        {!readOnly ? (
          <p id="member-phone-hint" className="text-sm text-muted-foreground">
            So you can call or text them, and so attendance follow-up texts
            reach them.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="member-email" className="text-base font-semibold">
          Email (optional)
        </label>
        <input
          id="member-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          readOnly={readOnly}
          autoComplete="off"
          className={inputClassName}
        />
      </div>

      {error ? (
        <p className="text-base text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {readOnly ? (
        <p className="text-[15px] text-muted-foreground">
          Only church admins can change these details.
        </p>
      ) : (
        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
          <Button type="submit" size="lg" className="sm:min-w-44" disabled={isSaving}>
            {isSaving ? "Saving…" : isEdit ? "Save details" : "Add person"}
          </Button>
          {!isEdit ? (
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          ) : null}
        </div>
      )}

      {!readOnly && isEdit && member ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-5">
          {member.is_active ? (
            <>
              <p className="text-[15px] text-muted-foreground">
                No longer coming? Deactivate {member.first_name} to take them
                off your list. Their history is kept.
              </p>
              <Button
                type="button"
                variant="destructive"
                className="self-start"
                disabled={isDeactivating}
                onClick={handleDeactivate}
              >
                {isDeactivating ? "Deactivating…" : `Deactivate ${member.first_name}`}
              </Button>
            </>
          ) : (
            <>
              <p className="text-[15px] text-muted-foreground">
                {member.first_name} is inactive. Their history is kept.
              </p>
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={isReactivating}
                onClick={handleReactivate}
              >
                {isReactivating ? "Reactivating…" : `Reactivate ${member.first_name}`}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </form>
  );

  const documentCount = care.details?.files.length ?? null;
  const title = isEdit && member ? fullName(member) : "Add person";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          {/*
            The list draws this person small; here there is room for a face.
            Someone still being added has no photo and no name to draw one
            from, so the circle waits until there is a person to show.
          */}
          {isEdit && member ? (
            <div
              className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/[0.08] font-heading text-xl font-bold text-primary dark:bg-accent/15 dark:text-accent"
              aria-hidden
            >
              <ProfileAvatar
                url={photoUrl ?? member.photo_url}
                initials={getInitials(member.first_name, member.last_name)}
              />
            </div>
          ) : null}
          <div className="min-w-0 space-y-1.5">
            <h2
              id="person-panel-title"
              className="truncate font-heading text-2xl font-bold text-foreground"
            >
              {title}
            </h2>
            {isEdit && member ? (
              !member.is_active ? (
                <StatusBadge tone="neutral">Inactive</StatusBadge>
              ) : showAppStatus && appConnection ? (
                <StatusBadge tone="ready">On the app</StatusBadge>
              ) : null
            ) : (
              <p className="text-base text-muted-foreground">
                Only a first name is needed. You can add the rest later.
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-6" aria-hidden />
        </button>
      </div>

      {isEdit && member ? (
        <ContactActions
          firstName={member.first_name}
          phone={member.phone}
          email={member.email}
          emptyText={
            isAdmin
              ? `No phone or email for ${member.first_name} yet. Add one under Details.`
              : `No phone or email for ${member.first_name} yet.`
          }
        />
      ) : null}

      {justAdded && member ? (
        <SuccessState
          title={`${fullName(member)} added.`}
          description="What would you like to do next?"
          className="gap-4 px-5 py-6"
          actions={
            <>
              <Button type="button" variant="outline" onClick={() => setTab("household")}>
                <Home aria-hidden />
                Add to a family
              </Button>
              <Link
                href="/dashboard/groups"
                className={buttonVariants({ variant: "outline" })}
              >
                <Users aria-hidden className="size-5" />
                Add to a group
              </Link>
              <Button type="button" variant="outline" onClick={onAddAnother}>
                <UserPlus aria-hidden />
                Add another
              </Button>
            </>
          }
        />
      ) : null}

      {/*
        The care, document and family sections carry forms of their own, so
        they sit beside the details form as tab panels rather than inside it: a
        nested <form> is invalid HTML that browsers resolve by dropping the
        inner one, silently, and only at runtime.
      */}
      {isEdit && member ? (
        <Tabs
          defaultValue="details"
          value={tab}
          onValueChange={(value) => setTab(value as PanelTab)}
        >
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="details"><span className="text-[15px]">Details</span></TabsTrigger>
            <TabsTrigger value="care"><span className="text-[15px]">Care</span></TabsTrigger>
            <TabsTrigger value="documents">
              <span className="text-[15px]">
                Documents{documentCount != null && documentCount > 0 ? ` (${documentCount})` : ""}
              </span>
            </TabsTrigger>
            <TabsTrigger value="household"><span className="text-[15px]">Family</span></TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="mt-6 flex flex-col gap-6">
            <p className="text-[15px] text-muted-foreground">
              {member.attendance_count > 0
                ? `At church ${member.attendance_count} ${
                    member.attendance_count === 1 ? "day" : "days"
                  }${
                    member.last_attended
                      ? `, most recently on ${formatFriendlyDate(member.last_attended)}`
                      : ""
                  }.`
                : "No attendance recorded yet."}
            </p>
            {showAppStatus ? (
              <MemberAppSection
                member={member}
                connection={appConnection}
                isAdmin={isAdmin}
                moveTargets={moveTargets}
                onMoved={onAppConnectionMoved}
              />
            ) : null}
            {detailsForm}
          </TabsContent>
          <TabsContent value="care" className="mt-6">
            <MemberCareSection
              memberId={member.id}
              memberName={member.first_name}
              isAdmin={isAdmin}
              state={care}
            />
          </TabsContent>
          <TabsContent value="documents" className="mt-6">
            <MemberDocumentsSection
              memberId={member.id}
              memberName={member.first_name}
              isAdmin={isAdmin}
              state={care}
            />
          </TabsContent>
          <TabsContent value="household" className="mt-6">
            <MemberHouseholdSection
              memberId={member.id}
              memberName={member.first_name}
              memberLastName={member.last_name}
              isAdmin={isAdmin}
              state={care}
            />
          </TabsContent>
        </Tabs>
      ) : (
        detailsForm
      )}
    </div>
  );
}
