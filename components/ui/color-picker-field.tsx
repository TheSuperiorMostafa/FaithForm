"use client";

import { Label } from "@/components/ui/label";
import { normalizeHexColor } from "@/lib/giving/branding";
import { cn } from "@/lib/utils";

type ColorPickerFieldProps = {
  id: string;
  label: string;
  value: string;
  defaultColor: string;
  disabled?: boolean;
  onChange: (color: string) => void;
  className?: string;
};

export function ColorPickerField({
  id,
  label,
  value,
  defaultColor,
  disabled = false,
  onChange,
  className,
}: ColorPickerFieldProps) {
  const resolved = normalizeHexColor(value) ?? defaultColor;

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="color"
          value={resolved}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-[10px] border border-border bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`${label} picker`}
        />
        <div
          className="flex h-11 min-w-0 flex-1 items-center rounded-[10px] border border-border px-3 text-sm font-medium text-white shadow-sm"
          style={{
            backgroundColor: resolved,
            textShadow: "0 1px 2px rgba(0,0,0,0.35)",
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
