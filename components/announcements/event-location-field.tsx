"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchLocations, trackLocationUsage } from "@/app/dashboard/announcements/location-actions";
import { formatAddressLine } from "@/lib/utils/address";

const addressFields = [
  { key: "address", label: "Street address", complete: "address-line1" },
  { key: "city", label: "City", complete: "address-level2" },
  { key: "state", label: "State or province", complete: "address-level1" },
  { key: "zip", label: "ZIP or postal code", complete: "postal-code" },
] as const;

/** Keep a venue name while adding a properly formatted street address. */
export function EventLocationField({
  id,
  value,
  onChange,
  actions,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  actions?: ReactNode;
}) {
  const [addingAddress, setAddingAddress] = useState(false);
  const [address, setAddress] = useState({ address: "", city: "", state: "", zip: "" });

  const [suggestions, setSuggestions] = useState<Array<{ label: string; value: string }>>([]);

  useEffect(() => {
    const query = value.trim();
    setSuggestions([]);
    if (query.length < 3) return;
    let active = true;
    const timer = setTimeout(() => {
      void searchLocations(query).then((result) => {
        if (active && result.ok) setSuggestions(result.suggestions);
      }).catch(() => {});
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value]);

  const addAddress = () => {
    const line = formatAddressLine(address);
    if (!line) return;
    const fullLocation = [value.trim(), line].filter(Boolean).join(" · ");
    onChange(fullLocation);
    void trackLocationUsage(fullLocation).catch(() => {});
    setAddingAddress(false);
    setAddress({ address: "", city: "", state: "", zip: "" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Input
        id={id}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          if (suggestions.some((suggestion) => suggestion.value === next)) {
            void trackLocationUsage(next).catch(() => {});
          }
        }}
        placeholder="Venue name or street address"
        autoComplete="off"
        list={suggestions.length ? `${id}-suggestions` : undefined}
      />
      {suggestions.length > 0 && (
        <datalist id={`${id}-suggestions`}>
          {suggestions.map(({ label, value }) => (
            <option key={value} value={value} label={label} />
          ))}
        </datalist>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="px-3"
          onClick={() => setAddingAddress((open) => !open)}
          aria-expanded={addingAddress}
          aria-controls={`${id}-address-fields`}
        >
          <MapPin className="size-4" aria-hidden />
          {addingAddress ? "Close address" : "Add street address"}
        </Button>
        {actions}
      </div>
      <div
        id={`${id}-address-fields`}
        hidden={!addingAddress}
        className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2 [&[hidden]]:hidden"
      >
        {addressFields.map((field) => (
          <div
            key={field.key}
            className={field.key === "address" ? "min-w-0 space-y-2 sm:col-span-2" : "min-w-0 space-y-2"}
          >
            <Label htmlFor={`${id}-${field.key}`}>{field.label}</Label>
            <Input
              id={`${id}-${field.key}`}
              autoComplete={field.complete}
              value={address[field.key]}
              onChange={(event) => setAddress((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start sm:col-span-2"
          disabled={!address.address.trim()}
          onClick={addAddress}
        >
          Use this address
        </Button>
      </div>
    </div>
  );
}
