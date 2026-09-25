"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type TransitionStartFunction,
} from "react";
import {
  AlertTriangle,
  FileText,
  Home,
  Lock,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import {
  addHouseholdMember,
  createHousehold,
  removeHouseholdMember,
} from "@/app/dashboard/checkin/actions";
import {
  getMemberCareDetails,
  saveMemberCareDetails,
  type MemberCareDetails,
} from "@/app/dashboard/people/care-actions";
import {
  deleteMemberFile,
  uploadMemberFile,
} from "@/app/dashboard/people/file-actions";
import {
  FAMILY_ROLE_HINTS,
  familySummary,
  formatFriendlyDate,
  suggestedFamilyName,
} from "@/components/people/people-format";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ALLOWED_MEMBER_FILE_EXTENSIONS,
  formatFileSize,
  MAX_MEMBER_FILE_BYTES,
} from "@/lib/checkin/member-files";
import { downscaleForUpload } from "@/lib/sites/downscale-image";
import {
  HOUSEHOLD_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  type HouseholdRelationship,
} from "@/types/checkin";

/**
 * The half of a person's record that is not a name and a phone number.
 *
 * A medical note lives here rather than in a children's-ministry corner
 * because an adult volunteer with a severe allergy is the same fact as a
 * four-year-old with one, and scoping it to children would mean building the
 * general version again the first time somebody asked.
 *
 * One fetch feeds three tabs. The details and the draft of the care fields
 * live in this hook rather than in the tab that shows them, so switching to
 * Documents and back does not throw away a half-typed allergy note.
 */
export type MemberCareState = {
  details: MemberCareDetails | null;
  loading: boolean;
  /** The last load failed; the tabs say so instead of looking empty. */
  failed: boolean;
  reload: () => void;
  pending: boolean;
  startTransition: TransitionStartFunction;
  draft: { medicalNotes: string; defaultLocationId: string };
  setDraft: (draft: { medicalNotes: string; defaultLocationId: string }) => void;
};

export function useMemberCareDetails(memberId: string | null): MemberCareState {
  const [details, setDetails] = useState<MemberCareDetails | null>(null);
  const [loading, setLoading] = useState(Boolean(memberId));
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState({ medicalNotes: "", defaultLocationId: "" });
  const [pending, startTransition] = useTransition();

  const reload = useCallback(() => {
    if (!memberId) return;
    setLoading(true);
    startTransition(async () => {
      const result = await getMemberCareDetails(memberId);
      setLoading(false);
      if (!result.ok) {
        setFailed(true);
        toast.error(result.error);
        return;
      }
      setFailed(false);
      setDetails(result.data);
      setDraft({
        medicalNotes: result.data.medicalNotes ?? "",
        defaultLocationId: result.data.defaultLocationId ?? "",
      });
    });
  }, [memberId]);

  useEffect(reload, [reload]);

  return { details, loading, failed, reload, pending, startTransition, draft, setDraft };
}

function Placeholder({ state }: { state: MemberCareState }) {
  if (state.loading && !state.details) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
        <Skeleton className="h-5 w-40" />
        <SkeletonText lines={2} />
        <Skeleton className="h-12 w-full rounded-[10px]" />
      </div>
    );
  }
  if (state.failed && !state.details) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-border p-5">
        <p className="text-[15px] text-foreground">
          We couldn&apos;t load this part of their record.
        </p>
        <Button type="button" variant="outline" onClick={state.reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (state.details && !state.details.available) {
    return (
      <p className="text-[15px] text-muted-foreground">
        Medical notes, documents and families come with Kids Check-in, which
        isn&apos;t turned on for your church yet.
      </p>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Care
// ---------------------------------------------------------------------------

export function MemberCareSection({
  memberId,
  memberName,
  isAdmin,
  state,
}: {
  memberId: string;
  memberName: string;
  isAdmin: boolean;
  state: MemberCareState;
}) {
  const placeholder = <Placeholder state={state} />;
  if (!state.details?.available) return placeholder;

  const { details, draft, setDraft, pending, startTransition } = state;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isAdmin) return;
        startTransition(async () => {
          const result = await saveMemberCareDetails({
            memberId,
            medicalNotes: draft.medicalNotes,
            defaultLocationId: draft.defaultLocationId,
          });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`Care notes saved for ${memberName}.`);
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="medical-notes" className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4" aria-hidden />
          Medical and allergy notes
        </Label>
        <textarea
          id="medical-notes"
          rows={4}
          value={draft.medicalNotes}
          readOnly={!isAdmin}
          onChange={(event) =>
            setDraft({ ...draft, medicalNotes: event.target.value })
          }
          placeholder="Peanut allergy: EpiPen in the blue bag."
          aria-describedby="medical-notes-hint"
          className="w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-base shadow-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 read-only:bg-muted/40"
        />
        <p id="medical-notes-hint" className="text-sm text-muted-foreground">
          Shown to volunteers when {memberName} is checked in and picked up.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="default-location" className="text-base">Usual room</Label>
        <Select
          id="default-location"
          value={draft.defaultLocationId}
          disabled={!isAdmin}
          onChange={(event) =>
            setDraft({ ...draft, defaultLocationId: event.target.value })
          }
          aria-describedby="default-location-hint"
        >
          <option value="">No usual room</option>
          {details.locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
        <p id="default-location-hint" className="text-sm text-muted-foreground">
          Chosen for them at check-in, so a volunteer only has to confirm it.
        </p>
      </div>

      {isAdmin ? (
        <Button type="submit" size="lg" className="self-start" disabled={pending}>
          {pending ? "Saving…" : "Save care notes"}
        </Button>
      ) : (
        <p className="text-[15px] text-muted-foreground">
          Only church admins can change care notes.
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function MemberDocumentsSection({
  memberId,
  memberName,
  isAdmin,
  state,
}: {
  memberId: string;
  memberName: string;
  isAdmin: boolean;
  state: MemberCareState;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const placeholder = <Placeholder state={state} />;
  if (!state.details?.available) return placeholder;

  const { details, pending, startTransition, reload } = state;

  async function remove(file: MemberCareDetails["files"][number]) {
    const confirmed = await confirmAction({
      title: `Delete “${file.label}”?`,
      description: `This permanently deletes ${file.fileName} from ${memberName}'s record for everyone. It can't be undone.`,
      confirmLabel: "Delete document",
      destructive: true,
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await deleteMemberFile(file.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`“${file.label}” deleted.`);
      reload();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {details.files.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-5 py-6 text-[15px] text-muted-foreground">
          No documents for {memberName} yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {details.files.map((file) => {
            const added = formatFriendlyDate(file.createdAt);
            const renews = formatFriendlyDate(file.expiresOn);
            return (
              <li key={file.id} className="flex flex-wrap items-start gap-3 px-4 py-4">
                <FileText
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/api/dashboard/people/files/${file.id}`}
                      className="text-base font-semibold text-primary underline-offset-4 hover:underline dark:text-accent"
                    >
                      {file.label}
                    </a>
                    {file.visibility === "church_admin" ? (
                      <StatusBadge tone="neutral">
                        <Lock className="size-3.5" aria-hidden />
                        Admins only
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="ready">All staff</StatusBadge>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {file.fileName} · {formatFileSize(file.sizeBytes)}
                    {added ? ` · added ${added}` : ""}
                    {file.uploadedByName ? ` by ${file.uploadedByName}` : ""}
                  </p>
                  {renews ? (
                    <p className="text-sm text-muted-foreground">Renews on {renews}</p>
                  ) : null}
                </div>
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => remove(file)}
                    aria-label={`Delete ${file.label}`}
                  >
                    <Trash2 aria-hidden />
                    Delete
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {isAdmin ? (
        <form
          className="rounded-2xl border border-border bg-muted/30 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            formData.set("memberId", memberId);
            const label = formData.get("label")?.toString().trim() || "Document";

            startTransition(async () => {
              const picked = formData.get("file");
              if (picked instanceof File && /^image\/(jpeg|png|webp)$/i.test(picked.type)) {
                formData.set("file", await downscaleForUpload(picked));
              }
              const file = formData.get("file");
              if (file instanceof File && file.size > MAX_MEMBER_FILE_BYTES) {
                toast.error(
                  `${file.name} is over ${Math.round(MAX_MEMBER_FILE_BYTES / (1024 * 1024))}MB. Compress it or upload a smaller file.`,
                );
                return;
              }

              try {
                const result = await uploadMemberFile(formData);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
              } catch {
                toast.error("That file couldn't be sent. Check your connection and try again.");
                return;
              }
              toast.success(`“${label}” uploaded to ${memberName}'s record.`);
              form.reset();
              if (fileInput.current) fileInput.current.value = "";
              reload();
            });
          }}
        >
          <h3 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
            <Upload className="size-5" aria-hidden />
            Add a document
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="file-input" className="text-base">File</Label>
              <Input
                id="file-input"
                ref={fileInput}
                name="file"
                type="file"
                required
                accept={ALLOWED_MEMBER_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="file-label" className="text-base">Name it</Label>
              <Input
                id="file-label"
                name="label"
                required
                placeholder="Background check 2026"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="file-visibility" className="text-base">Who can see it</Label>
              <Select id="file-visibility" name="visibility" defaultValue="church_admin">
                <option value="church_admin">Church admins only</option>
                <option value="staff">Anyone on staff</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="file-expires" className="text-base">Renews on (optional)</Label>
              <Input id="file-expires" name="expiresOn" type="date" />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={pending}>
                <Upload aria-hidden />
                Upload document
              </Button>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {ALLOWED_MEMBER_FILE_EXTENSIONS.join(", ")}, up to{" "}
            {Math.round(MAX_MEMBER_FILE_BYTES / (1024 * 1024))}MB. Big photos
            are shrunk to fit. Background checks should stay admins only.
          </p>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

export function MemberHouseholdSection({
  memberId,
  memberName,
  memberLastName = "",
  isAdmin,
  state,
}: {
  memberId: string;
  memberName: string;
  memberLastName?: string;
  isAdmin: boolean;
  state: MemberCareState;
}) {
  const [familyChoice, setFamilyChoice] = useState<string[]>([]);
  const [startingNew, setStartingNew] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState(() =>
    suggestedFamilyName(memberLastName, memberName),
  );

  const placeholder = <Placeholder state={state} />;
  if (!state.details?.available) return placeholder;

  const { details, pending, startTransition, reload } = state;
  const household = details.household;

  if (household) {
    const roleLabel =
      household.relationshipLabel ?? RELATIONSHIP_LABELS[household.relationship];

    const remove = async () => {
      const confirmed = await confirmAction({
        title: `Remove ${memberName} from ${household.name}?`,
        description:
          household.relationship === "guardian"
            ? `${memberName} stays in People, but will no longer be able to pick up this family's children with the family's pickup code.`
            : household.relationship === "dependent"
              ? `${memberName} stays in People, but can't be checked in with this family until they're added back.`
              : `${memberName} stays in People. Only the family link is removed.`,
        confirmLabel: "Remove from family",
        destructive: true,
      });
      if (!confirmed) return;
      startTransition(async () => {
        const formData = new FormData();
        formData.set("membershipId", household.membershipId);
        formData.set("householdId", household.id);
        const result = await removeHouseholdMember(formData);
        if (!result.ok) {
          toast.error(result.error ?? `We couldn't remove ${memberName}. Please try again.`);
          return;
        }
        toast.success(`${memberName} removed from ${household.name}.`);
        reload();
      });
    };

    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-4 rounded-2xl border border-border p-5">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-primary dark:bg-accent/15 dark:text-accent"
          >
            <Home className="size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-heading text-lg font-semibold">{household.name}</p>
            <p className="text-[15px] text-muted-foreground">
              {memberName} is a{" "}
              <strong className="font-semibold text-foreground">
                {roleLabel.toLowerCase()}
              </strong>{" "}
              in this family. {FAMILY_ROLE_HINTS[household.relationship]}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/dashboard/people/households/${household.id}`}
            className={buttonVariants({ variant: "outline" })}
          >
            <Users aria-hidden className="size-5" />
            Open family
          </Link>
          {isAdmin ? (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={remove}
            >
              Remove from family
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const families = details.households;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[15px] text-muted-foreground">
        {memberName} isn&apos;t in a family yet. Children need a family to be
        picked up, and a parent or guardian needs one to get the pickup code.
      </p>

      {isAdmin ? (
        <form
          className="flex flex-col gap-5 rounded-2xl border border-border bg-muted/30 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            formData.set("memberId", memberId);
            const relationship = formData.get("relationship")?.toString() as
              | HouseholdRelationship
              | undefined;
            if (!relationship) {
              toast.error(`Choose whether ${memberName} is a parent or guardian, a child, or another family member.`);
              return;
            }

            startTransition(async () => {
              let householdId = familyChoice[0] ?? "";
              let familyName =
                families.find((entry) => entry.id === householdId)?.name ?? "the family";

              if (startingNew || families.length === 0) {
                const name = newFamilyName.trim();
                if (!name) {
                  toast.error("Give the new family a name.");
                  return;
                }
                const createData = new FormData();
                createData.set("name", name);
                const created = await createHousehold(createData);
                if (!created.ok) {
                  toast.error(created.error);
                  return;
                }
                householdId = created.data.householdId;
                familyName = name;
              }

              if (!householdId) {
                toast.error("Choose a family, or start a new one.");
                return;
              }

              formData.set("householdId", householdId);
              const result = await addHouseholdMember(formData);
              if (!result.ok) {
                toast.error(result.error ?? `We couldn't add ${memberName}. Please try again.`);
                reload();
                return;
              }
              toast.success(`${memberName} added to ${familyName}.`);
              setFamilyChoice([]);
              setStartingNew(false);
              reload();
            });
          }}
        >
          <h3 className="font-heading text-lg font-semibold">
            Put {memberName} in a family
          </h3>

          {families.length > 0 && !startingNew ? (
            <div className="flex flex-col gap-3">
              <SearchPicker
                label="Which family?"
                items={families.map((entry) => ({
                  id: entry.id,
                  label: entry.name,
                  description: familySummary(entry),
                }))}
                value={familyChoice}
                onChange={setFamilyChoice}
                placeholder="Start typing a family name…"
                showAllWhenEmpty={families.length <= 6}
              />
              <Button
                type="button"
                variant="ghost"
                className="self-start"
                onClick={() => setStartingNew(true)}
              >
                Or start a new family
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-family-name" className="text-base">
                New family name
              </Label>
              <Input
                id="new-family-name"
                value={newFamilyName}
                onChange={(event) => setNewFamilyName(event.target.value)}
                placeholder="The Lopez family"
                required
              />
              {families.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  onClick={() => setStartingNew(false)}
                >
                  Choose an existing family instead
                </Button>
              ) : null}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="member-relationship" className="text-base">
              Is {memberName} a parent or guardian, or a child?
            </Label>
            <Select id="member-relationship" name="relationship" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {HOUSEHOLD_RELATIONSHIPS.map((value) => (
                <option key={value} value={value}>
                  {RELATIONSHIP_LABELS[value]}
                </option>
              ))}
            </Select>
            <ul className="space-y-1 pt-1 text-sm text-muted-foreground">
              {HOUSEHOLD_RELATIONSHIPS.map((value) => (
                <li key={value}>
                  <strong className="font-semibold text-foreground">
                    {RELATIONSHIP_LABELS[value]}:
                  </strong>{" "}
                  {FAMILY_ROLE_HINTS[value]}
                </li>
              ))}
            </ul>
          </div>

          <Button type="submit" size="lg" className="self-start" disabled={pending}>
            {startingNew || families.length === 0
              ? `Start family and add ${memberName}`
              : `Add ${memberName} to family`}
          </Button>
        </form>
      ) : (
        <Link
          href="/dashboard/people/households"
          className={buttonVariants({ variant: "outline", className: "self-start" })}
        >
          See all families
        </Link>
      )}
    </div>
  );
}
