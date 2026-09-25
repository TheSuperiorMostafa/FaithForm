"use client";

import { useFormStatus } from "react-dom";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";

/**
 * "Reset to defaults" throws away the church's own wording, so it asks first.
 * Once confirmed it submits the form with `reset=1`, exactly as the old
 * one-click button did, so the server behaviour is unchanged.
 */
export function ConfirmResetButton({
  title,
  description,
  confirmLabel,
  label = "Reset to our wording",
}: {
  title: string;
  description: string;
  confirmLabel: string;
  label?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name="reset"
      value="1"
      variant="ghost"
      formNoValidate
      disabled={pending}
      onClick={async (event) => {
        // requestSubmit() below does not fire another click, so this always
        // stops the native submit and asks first.
        const button = event.currentTarget as HTMLButtonElement;
        event.preventDefault();
        const ok = await confirmAction({
          title,
          description,
          confirmLabel,
          destructive: true,
        });
        if (!ok) return;
        button.form?.requestSubmit(button);
      }}
    >
      <RotateCcw aria-hidden />
      {label}
    </Button>
  );
}
