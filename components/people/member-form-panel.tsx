"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import {
  createMember,
  deactivateMember,
  reactivateMember,
  updateMember,
} from "@/app/dashboard/people/actions";
import { Button } from "@/components/ui/button";
import { MemberCarePanel } from "@/components/people/member-care-panel";
import type { ChurchMember } from "@/lib/queries/members";
import { formatPhoneDisplay } from "@/lib/people/validate-member";

type MemberFormPanelProps = {
  member?: ChurchMember | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (member: ChurchMember) => void;
  onDeactivated?: (memberId: string) => void;
  onReactivated?: (member: ChurchMember) => void;
};

const inputClassName =
  "min-h-12 rounded-[10px] border-[1.5px] border-border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function MemberFormPanel({
  member,
  isAdmin,
  onClose,
  onSaved,
  onDeactivated,
  onReactivated,
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

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-foreground">
            {readOnly ? "Person details" : isEdit ? "Edit person" : "Add person"}
          </h2>
          <p className="mt-1 text-base text-muted-foreground">
            {readOnly
              ? "Phone numbers are managed by church admins."
              : "Phone numbers are used for attendance follow-up texts."}
          </p>
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

      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!readOnly) handleSave();
        }}
      >
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

        <div className="flex flex-col gap-2">
          <label htmlFor="member-phone" className="text-base font-semibold">
            Phone
          </label>
          <input
            id="member-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            readOnly={readOnly}
            placeholder="(502) xxx-xxxx"
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

        <div className="flex flex-col gap-3 pt-2">
          {readOnly ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base"
              onClick={onClose}
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                type="submit"
                className="h-12 w-full text-base"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </Button>

              {isEdit && member ? (
                member.is_active ? (
                  confirmDeactivate ? (
                    <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
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
                      variant="outline"
                      className="h-11 w-full text-base text-destructive"
                      onClick={() => setConfirmDeactivate(true)}
                    >
                      Deactivate person
                    </Button>
                  )
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full text-base"
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

      {/*
        Outside the form above, not inside it. The care panel has upload and
        save forms of its own, and a nested <form> is invalid HTML that browsers
        resolve by dropping the inner one — silently, and only at runtime.
      */}
      {isEdit && member ? (
        <section className="mt-6 border-t border-border pt-6">
          <h2 className="mb-4 font-heading text-lg font-semibold">
            Care &amp; documents
          </h2>
          <MemberCarePanel
            memberId={member.id}
            memberName={member.first_name}
            isAdmin={isAdmin}
          />
        </section>
      ) : null}
    </div>
  );
}
