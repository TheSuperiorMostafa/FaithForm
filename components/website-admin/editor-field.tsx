"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Label } from "@/components/ui/label";

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-required"?: boolean };

/** Keep the visible field name and help connected to its actual control. */
export function EditorField({ label, help, required, children }: {
  label: string;
  help?: string;
  required?: boolean;
  children?: ReactNode;
}) {
  const generatedId = useId();
  const control = isValidElement(children) ? children as ReactElement<ControlProps> : null;
  const id = control?.props.id ?? generatedId;
  const helpId = `${id}-help`;
  const describedBy = [control?.props["aria-describedby"], help ? helpId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}{required ? <span aria-hidden className="text-destructive"> *</span> : null}
      </Label>
      {control ? cloneElement(control, { id, "aria-describedby": describedBy, "aria-required": control.props["aria-required"] ?? (required || undefined) }) : children}
      {help ? <p id={helpId} className="text-sm text-muted-foreground">{help}</p> : null}
    </div>
  );
}
