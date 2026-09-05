"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, FileText, Lock, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

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
} from "@/lib/checkin/member-files";

/**
 * The half of a person's record that is not a name and a phone number.
 *
 * A medical note lives here rather than in a children's-ministry corner
 * because an adult volunteer with a severe allergy is the same fact as a
 * four-year-old with one, and scoping it to children would mean building the
 * general version again the first time somebody asked.
 */
export function MemberCarePanel({
  memberId,
  memberName,
  isAdmin,
}: {
  memberId: string;
  memberName: string;
  isAdmin: boolean;
}) {
  const [details, setDetails] = useState<MemberCareDetails | null>(null);
  const [medicalNotes, setMedicalNotes] = useState("");
  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function reload() {
    startTransition(async () => {
      const result = await getMemberCareDetails(memberId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDetails(result.data);
      setMedicalNotes(result.data.medicalNotes ?? "");
      setDefaultLocationId(result.data.defaultLocationId ?? "");
    });
  }

  useEffect(reload, [memberId]);

  if (!details) {
    return (
      <p className="text-sm text-muted-foreground">Loading care details…</p>
    );
  }

  if (!details.available) {
    return (
      <p className="text-sm text-muted-foreground">
        Medical notes and documents arrive with Check-In, which is not set up on
        this database yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        <Label htmlFor="medical-notes" className="flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" aria-hidden />
          Medical &amp; allergy notes
        </Label>
        <textarea
          id="medical-notes"
          rows={3}
          value={medicalNotes}
          readOnly={!isAdmin}
          onChange={(event) => setMedicalNotes(event.target.value)}
          placeholder="Peanut allergy — EpiPen in the blue bag."
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
          value={defaultLocationId}
          disabled={!isAdmin}
          onChange={(event) => setDefaultLocationId(event.target.value)}
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
            size="sm"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const result = await saveMemberCareDetails({
                  memberId,
                  medicalNotes,
                  defaultLocationId,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Saved.");
              });
            }}
          >
            Save care details
          </Button>
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <FileText className="size-4" aria-hidden />
          <h3 className="text-sm font-semibold">Documents</h3>
        </div>

        {details.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents on file.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {details.files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <a
                    href={`/api/dashboard/people/files/${file.id}`}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {file.label}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {file.fileName} · {formatFileSize(file.sizeBytes)} ·{" "}
                    {new Date(file.createdAt).toLocaleDateString()}
                    {file.uploadedByName && ` · ${file.uploadedByName}`}
                    {file.expiresOn && ` · renews ${file.expiresOn}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {file.visibility === "church_admin" ? (
                    <Badge variant="muted">
                      <Lock className="mr-1 size-3" aria-hidden />
                      Admins only
                    </Badge>
                  ) : (
                    <Badge variant="info">All staff</Badge>
                  )}
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
                </div>
              </li>
            ))}
          </ul>
        )}

        {isAdmin && (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const formData = new FormData(form);
              formData.set("memberId", memberId);

              startTransition(async () => {
                const result = await uploadMemberFile(formData);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Document uploaded.");
                form.reset();
                if (fileInput.current) fileInput.current.value = "";
                reload();
              });
            }}
          >
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
            <div className="space-y-2">
              <Label htmlFor="file-input">File</Label>
              <Input id="file-input" ref={fileInput} name="file" type="file" required />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                <Upload className="mr-1.5 size-3.5" aria-hidden />
                Upload
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {ALLOWED_MEMBER_FILE_EXTENSIONS.join(", ")}. Background checks
                default to admins only — nobody on general staff sees them
                unless you say so.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
