"use client";

import { Select } from "@/components/ui/select";
import { COMMON_KEYS } from "@/lib/service-plans/songs/types";

/** Key picker. A key outside the usual list (from an import) stays selectable. */
export function KeySelect({
  id,
  value,
  onChange,
  emptyLabel = "No key",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
}) {
  const keys: string[] = [...COMMON_KEYS];
  if (value && !keys.includes(value)) keys.unshift(value);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {keys.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </Select>
  );
}
