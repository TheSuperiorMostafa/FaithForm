"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The one confirmation pattern for the dashboard. Replaces `window.confirm`
 * and one-click destructive buttons.
 *
 * Rules (see docs/ux/DASHBOARD_SIMPLICITY_STANDARD.md §9):
 * - Only for irreversible or wide-reach actions. Reversible actions use an
 *   Undo toast instead.
 * - Say the consequence with specifics in `description`.
 * - `confirmLabel` is verb + object ("Delete room", "Send 12 texts"), never
 *   "Yes" or "OK". `cancelLabel` defaults to "Go back".
 */
export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** For extreme risk: the person must type this word to enable the button. */
  typeToConfirm?: string;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let push: ((request: Pending) => void) | null = null;

/**
 * Ask for confirmation from anywhere in client code.
 *
 *   if (!(await confirmAction({ title: "Delete Nursery?", confirmLabel: "Delete room", destructive: true }))) return;
 *
 * Falls back to `window.confirm` only if the host is not mounted, so a missing
 * host can never turn a destructive action into a one-click one.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (!push) {
    const text = typeof options.description === "string" ? `\n\n${options.description}` : "";
    return Promise.resolve(window.confirm(`${options.title}${text}`));
  }
  return new Promise((resolve) => push?.({ ...options, resolve }));
}

/** Mounted once in the dashboard shell. */
export function ConfirmHost() {
  const [request, setRequest] = React.useState<Pending | null>(null);
  const [typed, setTyped] = React.useState("");

  React.useEffect(() => {
    push = (next) => {
      setTyped("");
      setRequest(next);
    };
    return () => {
      push = null;
    };
  }, []);

  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
      options={request}
      typed={typed}
      onTypedChange={setTyped}
      onConfirm={() => close(true)}
    />
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ConfirmOptions | null;
  onConfirm: () => void;
  pending?: boolean;
  typed?: string;
  onTypedChange?: (value: string) => void;
};

/** Controlled variant, for places that need a pending state while the action runs. */
export function ConfirmDialog({
  open,
  onOpenChange,
  options,
  onConfirm,
  pending = false,
  typed = "",
  onTypedChange,
}: ConfirmDialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  if (!options) {
    return (
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }
  const {
    title,
    description,
    confirmLabel,
    cancelLabel = "Go back",
    destructive = false,
    typeToConfirm,
  } = options;
  const blocked =
    pending || (typeToConfirm ? typed.trim().toLowerCase() !== typeToConfirm.trim().toLowerCase() : false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        showClose={false}
      >
        <DialogHeader className="flex-row items-start gap-4 border-b-0 pb-2">
          {destructive && (
            <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-5" aria-hidden />
            </span>
          )}
          <div className="space-y-2">
            <DialogTitle id={titleId}>{title}</DialogTitle>
            {description && (
              <DialogDescription id={descriptionId} className="text-base">
                {description}
              </DialogDescription>
            )}
          </div>
        </DialogHeader>
        {typeToConfirm && (
          <div className="space-y-2 px-6 pb-2">
            <label className="text-sm font-semibold text-foreground" htmlFor={`${titleId}-type`}>
              Type <span className="font-bold">{typeToConfirm}</span> to confirm
            </label>
            <Input
              id={`${titleId}-type`}
              value={typed}
              autoComplete="off"
              onChange={(e) => onTypedChange?.(e.target.value)}
            />
          </div>
        )}
        <DialogFooter className="border-t-0 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            autoFocus
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={blocked}
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground",
            )}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
