"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Smartphone, X } from "lucide-react";
import { toast } from "sonner";

import {
  createMember,
  deactivateMember,
  reactivateMember,
  updateMember,
} from "@/app/dashboard/people/actions";
import { moveAppConnectionToPerson } from "@/app/dashboard/people/claim-actions";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { Select } from "@/components/ui/select";
import { ProfileAvatar } from "@/components/dashboard/profile-avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MemberCareSection,
  MemberDocumentsSection,
  MemberHouseholdSection,
  useMemberCareDetails,
} from "@/components/people/member-care-panel";
import type { ChurchMember } from "@/lib/queries/members";
import { formatPhoneDisplay } from "@/lib/people/validate-member";

type MemberFormPanelProps = {
  member?: ChurchMember | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (member: ChurchMember) => void;
  onDeactivated?: (memberId: string) => void;
  onReactivated?: (member: ChurchMember) => void;
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

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function formatDay(value: string | null | undefined): string | null {
  if (!value) return null;
  // A church's calendar day ("2026-09-13") is read at noon UTC and printed in
  // UTC, so no viewer's timezone can move it to the day before.
  const isCalendarDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isCalendarDay ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(isCalendarDay ? { timeZone: "UTC" } : {}),
  });
}

function fullName(member: Pick<ChurchMember, "first_name" | "last_name">): string {
  return `${member.first_name} ${member.last_name}`.trim();
}

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
  const [target, setTarget] = useState("");
  const [pending, startTransition] = useTransition();

  if (!connection) {
    return (
      <section className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-semibold text-foreground">Not on the app yet</p>
          <p className="text-muted-foreground">
            When {member.first_name} joins your church in the FaithForm app,
            they are connected here and their check-ins count automatically.{" "}
            <Link href="/dashboard/app" className="font-medium text-accent hover:underline">
              Share an invitation link
            </Link>
          </p>
        </div>
      </section>
    );
  }

  const sortedTargets = [...moveTargets].sort((a, b) =>
    fullName(a).localeCompare(fullName(b)),
  );

  const move = () => {
    if (!target) {
      toast.error("Choose who this app account belongs to.");
      return;
    }
    const chosen = sortedTargets.find((candidate) => candidate.id === target);
    startTransition(async () => {
      const result = await moveAppConnectionToPerson({
        fromMemberId: member.id,
        toMemberId: target,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        chosen ? `The app connection is now ${fullName(chosen)}'s.` : "App connection moved.",
      );
      onMoved?.();
    });
  };

  const since = formatDay(connection.linkedAt);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-brand-navy/20 bg-brand-navy/5 p-4 dark:border-brand-gold/30 dark:bg-brand-gold/10">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-primary dark:text-accent" aria-hidden />
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-semibold text-foreground">
            On the FaithForm app{since ? ` since ${since}` : ""}
          </p>
          <p className="text-muted-foreground">
            Check-ins from the app — automatic on arrival, or by scanning the
            service code — count as {member.first_name}&apos;s attendance.
            {member.source === "app"
              ? " This record was added when they joined in the app."
              : ""}
          </p>
        </div>
      </div>

      {isAdmin ? (
        moving ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`move-${member.id}`} className="text-sm font-semibold text-foreground">
              Which person is this app account?
            </label>
            <Select
              id={`move-${member.id}`}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={pending}
            >
              <option value="">Choose someone…</option>
              {sortedTargets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {fullName(candidate)}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              {member.source === "app"
                ? `Their check-ins move with the connection, and this record is deactivated — it only existed for this app account.`
                : `Check-ins already recorded stay with ${member.first_name}; new ones go to the person you choose.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={pending || !target} onClick={move}>
                {pending ? "Moving…" : "Move the app connection"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setMoving(false);
                  setTarget("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMoving(true)}
            className="self-start text-sm font-medium text-accent hover:underline"
          >
            Not the right person? Move this app connection
          </button>
        )
      ) : null}
    </section>
  );
}

const inputClassName =
  "min-h-12 rounded-[10px] border-[1.5px] border-border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/**
 * One person, in tabs.
 *
 * Details, care, documents and household used to sit in one column that had
 * to be scrolled top to bottom and back, with two Save buttons a screen apart.
 * Each is now its own tab, and the panel is wide enough that the upload form
 * lays out in two columns instead of a stack of five.
 */
export function MemberFormPanel({
  member,
  isAdmin,
  onClose,
  onSaved,
  onDeactivated,
  onReactivated,
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
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

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

      toast.success(isEdit ? "Person updated" : "Person added");
      onSaved(result.member);
    });
  }

  function handleDeactivate() {
    if (!member) return;
    setError(null);

    startDeactivateTransition(async () => {
      const result = await deactivateMember(member.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.success(`${member.first_name} deactivated`);
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

      toast.success(`${member.first_name} reactivated`);
      onReactivated?.(result.member);
    });
  }

  const detailsForm = (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly) handleSave();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
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
            className={inputClassName}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="member-phone" className="text-base font-semibold">
          Phone
        </label>
        <PhoneInput
          id="member-phone"
          value={phone}
          onValueChange={setPhone}
          readOnly={readOnly}
          className={inputClassName}
        />
        {!readOnly ? (
          <p className="text-xs text-muted-foreground">
            Used for attendance follow-up texts.
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
          className={inputClassName}
        />
      </div>

      {error ? (
        <p className="text-base text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
        {readOnly ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 text-base sm:w-auto"
            onClick={onClose}
          >
            Close
          </Button>
        ) : (
          <>
            <Button
              type="submit"
              className="h-12 text-base sm:min-w-40"
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : isEdit ? "Save" : "Add person"}
            </Button>

            {isEdit && member ? (
              member.is_active ? (
                confirmDeactivate ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-1">
                    <p className="text-sm text-foreground">
                      Remove {member.first_name} from the active roster?
                      Attendance history is kept.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 flex-1 text-base"
                        onClick={() => setConfirmDeactivate(false)}
                      >
                        Keep
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        className="h-11 flex-1 text-base"
                        disabled={isDeactivating}
                        onClick={handleDeactivate}
                      >
                        {isDeactivating ? "Removing..." : "Deactivate"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 text-base text-destructive sm:ml-auto"
                    onClick={() => setConfirmDeactivate(true)}
                  >
                    Deactivate person
                  </Button>
                )
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 text-base sm:ml-auto"
                  disabled={isReactivating}
                  onClick={handleReactivate}
                >
                  {isReactivating ? "Reactivating..." : "Reactivate person"}
                </Button>
              )
            ) : null}
          </>
        )}
      </div>
    </form>
  );

  const documentCount = care.details?.files.length ?? null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-4">
          {/*
            The list draws this person small; here there is room for a face.
            Someone still being added has no photo and no name to draw one
            from, so the circle waits until there is a person to show.
          */}
          {isEdit && member ? (
            <div
              className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/15 text-xl font-bold text-accent"
              aria-hidden
            >
              <ProfileAvatar
                url={photoUrl ?? member.photo_url}
                initials={getInitials(member.first_name, member.last_name)}
              />
            </div>
          ) : null}
          <div className="min-w-0">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {readOnly
                ? "Person details"
                : isEdit && member
                  ? `${member.first_name} ${member.last_name}`.trim()
                  : "Add person"}
            </h2>
            <p className="mt-1 text-base text-muted-foreground">
              {readOnly
                ? "Phone numbers are managed by church admins."
                : isEdit
                  ? "Details, care notes, documents and household in one place."
                  : "Phone numbers are used for attendance follow-up texts."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {/*
        The care, document and household sections carry forms of their own, so
        they sit beside the details form as tab panels rather than inside it: a
        nested <form> is invalid HTML that browsers resolve by dropping the
        inner one, silently, and only at runtime.
      */}
      {isEdit && member ? (
        <Tabs defaultValue="details" className="mt-4">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="care">Care</TabsTrigger>
            <TabsTrigger value="documents">
              Documents{documentCount != null && documentCount > 0 ? ` (${documentCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="household">Household</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="mt-5 flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              {member.attendance_count > 0
                ? `At church ${member.attendance_count} ${
                    member.attendance_count === 1 ? "day" : "days"
                  }${
                    member.last_attended
                      ? `, most recently ${formatDay(member.last_attended)}`
                      : ""
                  } — marked on the weekly sheet, or checked in by the app, a code, the kiosk or a room.`
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
          <TabsContent value="care" className="mt-5">
            <MemberCareSection
              memberId={member.id}
              memberName={member.first_name}
              isAdmin={isAdmin}
              state={care}
            />
          </TabsContent>
          <TabsContent value="documents" className="mt-5">
            <MemberDocumentsSection
              memberId={member.id}
              isAdmin={isAdmin}
              state={care}
            />
          </TabsContent>
          <TabsContent value="household" className="mt-5">
            <MemberHouseholdSection
              memberId={member.id}
              memberName={member.first_name}
              isAdmin={isAdmin}
              state={care}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="mt-5">{detailsForm}</div>
      )}
    </div>
  );
}
