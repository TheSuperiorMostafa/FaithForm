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
  ExternalLink,
  FileText,
  Home,
  Lock,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  addHouseholdMember,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  ALLOWED_MEMBER_FILE_EXTENSIONS,
  formatFileSize,
  MAX_MEMBER_FILE_BYTES,
} from "@/lib/checkin/member-files";
import { downscaleForUpload } from "@/lib/sites/downscale-image";
import {
  HOUSEHOLD_RELATIONSHIPS,
  RELATIONSHIP_DESCRIPTIONS,
  RELATIONSHIP_LABELS,
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
  reload: () => void;
  pending: boolean;
  startTransition: TransitionStartFunction;
  draft: { medicalNotes: string; defaultLocationId: string };
  setDraft: (draft: { medicalNotes: string; defaultLocationId: string }) => void;
};

export function useMemberCareDetails(memberId: string | null): MemberCareState {
  const [details, setDetails] = useState<MemberCareDetails | null>(null);
  const [loading, setLoading] = useState(Boolean(memberId));
  const [draft, setDraft] = useState({ medicalNotes: "", defaultLocationId: "" });
  const [pending, startTransition] = useTransition();

  const reload = useCallback(() => {
    if (!memberId) return;
    setLoading(true);
    startTransition(async () => {
      const result = await getMemberCareDetails(memberId);
      setLoading(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDetails(result.data);
      setDraft({
        medicalNotes: result.data.medicalNotes ?? "",
        defaultLocationId: result.data.defaultLocationId ?? "",
      });
    });
  }, [memberId]);

  useEffect(reload, [reload]);

  return { details, loading, reload, pending, startTransition, draft, setDraft };
}

function Placeholder({ state }: { state: MemberCareState }) {
  if (state.loading && !state.details) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (state.details && !state.details.available) {
    return (
      <p className="text-sm text-muted-foreground">
        Medical notes, documents and households arrive with Check-In, which is
        not set up on this database yet.
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
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        <Label htmlFor="medical-notes" className="flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" aria-hidden />
          Medical &amp; allergy notes
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
          className="w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] shadow-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 read-only:opacity-70"
        />
        <p className="text-xs text-muted-foreground">
          Shown at check-in and at checkout, wherever {memberName} appears.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="default-location">Usual room</Label>
        <Select
          id="default-location"
          value={draft.defaultLocationId}
          disabled={!isAdmin}
          onChange={(event) =>
            setDraft({ ...draft, defaultLocationId: event.target.value })
          }
        >
          <option value="">No usual room</option>
          {details.locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          Pre-selected at check-in, so a volunteer confirms rather than chooses.
        </p>
      </div>

      {isAdmin && (
        <div>
          <Button
            type="button"
            className="h-11"
            disabled={pending}
            onClick={() => {
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
                toast.success("Care details saved.");
              });
            }}
          >
            Save care details
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function MemberDocumentsSection({
  memberId,
  isAdmin,
  state,
}: {
  memberId: string;
  isAdmin: boolean;
  state: MemberCareState;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const placeholder = <Placeholder state={state} />;
  if (!state.details?.available) return placeholder;

  const { details, pending, startTransition, reload } = state;

  return (
    <div className="flex flex-col gap-5">
      {details.files.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
          No documents on file.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {details.files.map((file) => (
            <li key={file.id} className="flex items-start gap-3 px-4 py-3">
              <FileText
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/api/dashboard/people/files/${file.id}`}
                    className="text-sm font-semibold text-accent hover:underline"
                  >
                    {file.label}
                  </a>
                  {file.visibility === "church_admin" ? (
                    <Badge variant="muted">
                      <Lock className="mr-1 size-3" aria-hidden />
                      Admins only
                    </Badge>
                  ) : (
                    <Badge variant="info">All staff</Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {file.fileName} · {formatFileSize(file.sizeBytes)} · added{" "}
                  {new Date(file.createdAt).toLocaleDateString()}
                  {file.uploadedByName && ` by ${file.uploadedByName}`}
                </p>
                {file.expiresOn && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Renews {file.expiresOn}
                  </p>
                )}
              </div>
              {isAdmin && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${file.label}`}
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await deleteMemberFile(file.id);
                      if (!result.ok) {
                        toast.error(result.error);
                        return;
                      }
                      toast.success("Document removed.");
                      reload();
                    });
                  }}
                >
                  <Trash2 className="size-4 text-destructive" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <form
          className="rounded-xl border border-border bg-muted/30 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            formData.set("memberId", memberId);

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
                toast.error("That file could not be sent. Check your connection and try again.");
                return;
              }
              toast.success("Document uploaded.");
              form.reset();
              if (fileInput.current) fileInput.current.value = "";
              reload();
            });
          }}
        >
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Upload className="size-4" aria-hidden />
            Add a document
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="file-input">File</Label>
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
              <Label htmlFor="file-label">Label</Label>
              <Input
                id="file-label"
                name="label"
                required
                placeholder="Background check 2026"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="file-visibility">Who can see it</Label>
              <Select id="file-visibility" name="visibility" defaultValue="church_admin">
                <option value="church_admin">Church admins only</option>
                <option value="staff">Anyone on staff</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="file-expires">Renews on (optional)</Label>
              <Input id="file-expires" name="expiresOn" type="date" />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="h-11 w-full" disabled={pending}>
                <Upload className="mr-1.5 size-4" aria-hidden />
                Upload
              </Button>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {ALLOWED_MEMBER_FILE_EXTENSIONS.join(", ")}, up to{" "}
            {Math.round(MAX_MEMBER_FILE_BYTES / (1024 * 1024))}MB; photos larger
            than that are shrunk to fit. Background checks default to admins only:
            nobody on general staff sees them unless you say so.
          </p>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Household
// ---------------------------------------------------------------------------

export function MemberHouseholdSection({
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

  const { details, pending, startTransition, reload } = state;
  const household = details.household;

  if (household) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border border-border p-4">
          <Home className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-heading text-base font-semibold">{household.name}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {memberName} is a{" "}
              <strong className="font-medium text-foreground">
                {household.relationshipLabel ??
                  RELATIONSHIP_LABELS[household.relationship].toLowerCase()}
              </strong>{" "}
              here. {RELATIONSHIP_DESCRIPTIONS[household.relationship]}
            </p>
            <Link
              href={`/dashboard/people/households/${household.id}`}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              Open household
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>

        {isAdmin && (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-fit text-destructive"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const formData = new FormData();
                formData.set("membershipId", household.membershipId);
                formData.set("householdId", household.id);
                const result = await removeHouseholdMember(formData);
                if (!result.ok) {
                  toast.error(result.error ?? "Could not remove them.");
                  return;
                }
                toast.success(`${memberName} removed from ${household.name}.`);
                reload();
              });
            }}
          >
            Remove from this household
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {memberName} is not in a household yet. A child needs one to be collected
        at checkout; an adult needs one to hold the pickup code.
      </p>

      {isAdmin && details.households.length > 0 && (
        <form
          className="rounded-xl border border-border bg-muted/30 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            formData.set("memberId", memberId);
            startTransition(async () => {
              const result = await addHouseholdMember(formData);
              if (!result.ok) {
                toast.error(result.error ?? "Could not add them.");
                return;
              }
              toast.success(`${memberName} added.`);
              form.reset();
              reload();
            });
          }}
        >
          <p className="mb-3 text-sm font-semibold">Add to a household</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="member-household">Household</Label>
              <Select id="member-household" name="householdId" required defaultValue="">
                <option value="">Choose a household…</option>
                {details.households.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="member-relationship">As</Label>
              <Select id="member-relationship" name="relationship" required>
                {HOUSEHOLD_RELATIONSHIPS.map((value) => (
                  <option key={value} value={value}>
                    {RELATIONSHIP_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end sm:col-span-2">
              <Button type="submit" className="h-11" disabled={pending}>
                Add to household
              </Button>
            </div>
          </div>
          <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">
            {HOUSEHOLD_RELATIONSHIPS.map((value) => (
              <li key={value}>
                <strong className="text-foreground">{RELATIONSHIP_LABELS[value]}</strong>{" "}
                {RELATIONSHIP_DESCRIPTIONS[value]}
              </li>
            ))}
          </ul>
        </form>
      )}

      <Link
        href="/dashboard/people/households"
        className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
      >
        {details.households.length === 0 ? "Create the first household" : "All households"}
        <ExternalLink className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}
