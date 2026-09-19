"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { formatUsPhoneInput } from "@/lib/sms/phone";

type PhoneInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** Called with the formatted value (`123-456-7890`), not the raw keystrokes. */
  onValueChange?: (value: string) => void;
};

/**
 * A phone field that formats as it is typed: 123-456-7890.
 *
 * Works controlled (`value` + `onValueChange`) or inside a plain form
 * (`name` + `defaultValue`), because the formatted text is written back to the
 * input itself. The server still normalises with `toE164`, which ignores the
 * dashes, so nothing downstream changes.
 */
function PhoneInput({
  onValueChange,
  onChange,
  placeholder = "123-456-7890",
  defaultValue,
  value,
  ...props
}: PhoneInputProps) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={placeholder}
      value={typeof value === "string" ? formatUsPhoneInput(value) : value}
      defaultValue={
        typeof defaultValue === "string" ? formatUsPhoneInput(defaultValue) : defaultValue
      }
      onChange={(event) => {
        const formatted = formatUsPhoneInput(event.target.value);
        if (formatted !== event.target.value) event.target.value = formatted;
        onValueChange?.(formatted);
        onChange?.(event);
      }}
      {...props}
    />
  );
}

export { PhoneInput };
