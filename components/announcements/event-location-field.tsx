"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getChurchEventLocation, searchLocations, trackLocationUsage, type EventLocationSuggestion } from "@/app/dashboard/announcements/location-actions";
import { SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
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

  const [suggestions, setSuggestions] = useState<EventLocationSuggestion[]>([]);
  const [focused, setFocused] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [churchPending, setChurchPending] = useState(false);

  useEffect(() => {
    const query = value.trim();
    setSuggestions([]);
    setActiveIndex(-1);
    setMessage("");
    if (!focused || query.length < 3 || value === selectedValue) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void searchLocations(query).then((result) => {
        if (!active) return;
        setLoading(false);
        if (!result.ok) { setMessage(result.error); return; }
        setSuggestions(result.suggestions);
        const note = result.addressSearch !== "ready"
          ? "Address search is unavailable right now. You can still type the full address or use the church address."
          : !result.suggestions.length && !result.notice ? "No matching addresses. You can still type the full address." : "";
        setMessage([result.notice, note].filter(Boolean).join(" "));
      }).catch(() => {
        if (active) { setLoading(false); setMessage("Address suggestions couldn't load. You can still type the full address."); }
      });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [value, focused, selectedValue]);

  const choose = (suggestion: EventLocationSuggestion) => {
    onChange(suggestion.value);
    setSelectedValue(suggestion.value);
    setSuggestions([]);
    setFocused(false);
    // Google predictions are transient suggestions, not an automatic saved-location library.
    if (suggestion.source === "saved") void trackLocationUsage(suggestion.value).catch(() => {});
  };

  const fillChurchAddress = async () => {
    setChurchPending(true);
    setMessage("");
    try {
      const result = await getChurchEventLocation();
      if (!result.ok) { setMessage(result.error); return; }
      onChange(result.value);
      setSelectedValue(result.value);
      setSuggestions([]);
      setFocused(false);
    } catch { setMessage("We couldn't load the church address. Type it here or try again."); }
    finally { setChurchPending(false); }
  };

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
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => { onChange(event.target.value); setSelectedValue(null); setFocused(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && focused) { event.preventDefault(); event.stopPropagation(); setFocused(false); }
          if (!suggestions.length || !focused) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(index => event.key === "ArrowDown" ? (index + 1) % suggestions.length : (index < 1 ? suggestions.length - 1 : index - 1));
          } else if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            choose(suggestions[activeIndex]);
          }
        }}
        placeholder="Search for a venue or street address"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={focused && suggestions.length > 0}
        aria-controls={`${id}-suggestions`}
        aria-activedescendant={focused && activeIndex >= 0 ? `${id}-suggestion-${activeIndex}` : undefined}
        aria-describedby={message ? `${id}-location-message` : undefined}
      />
      {focused && loading ? <SkeletonContainer label="address suggestions" className="rounded-xl border border-border p-3"><SkeletonText lines={2} /></SkeletonContainer> : null}
      {focused && suggestions.length > 0 ? <ul id={`${id}-suggestions`} role="listbox" aria-label="Address suggestions" className="max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-sm">
        {suggestions.map((suggestion, index) => <li key={`${suggestion.source}-${suggestion.value}`} role="presentation">
          <button type="button" role="option" id={`${id}-suggestion-${index}`} aria-selected={activeIndex === index}
            tabIndex={-1} onPointerDown={event => event.preventDefault()} onClick={() => choose(suggestion)}
            className={`flex min-h-11 w-full flex-col items-start gap-1 rounded-lg px-3 py-2 text-left text-[15px] text-popover-foreground hover:bg-muted ${activeIndex === index ? "bg-muted" : ""}`}>
            <span className="break-words">{suggestion.value}</span>
            <span className="whitespace-nowrap text-xs font-normal text-muted-foreground" translate={suggestion.source === "google" ? "no" : undefined}>{suggestion.source === "google" ? "Google Maps" : suggestion.label}</span>
          </button>
        </li>)}
      </ul> : null}
      {message ? <p id={`${id}-location-message`} role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      <div className="flex flex-wrap gap-2 [&_button]:min-h-11">
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
        {actions ?? <Button type="button" variant="outline" size="sm" disabled={churchPending} onClick={() => { void fillChurchAddress(); }}>
          {churchPending ? "Loading church address…" : "Use church address"}
        </Button>}
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
