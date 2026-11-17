"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getChurchEventLocation, resolveLocationSelection, searchLocations, trackLocationUsage, type EventLocationSuggestion } from "@/app/dashboard/announcements/location-actions";
import { SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { formatAddressLine } from "@/lib/utils/address";

const addressFields = [
  { key: "address", label: "Street address", complete: "address-line1" },
  { key: "city", label: "City", complete: "address-level2" },
  { key: "state", label: "State or province", complete: "address-level1" },
  { key: "zip", label: "ZIP or postal code", complete: "postal-code" },
] as const;

export type EventLocationProvider = {
  search: typeof searchLocations;
  resolve: typeof resolveLocationSelection;
  churchAddress: typeof getChurchEventLocation;
  trackUsage?: typeof trackLocationUsage;
};
const announcementLocations: EventLocationProvider = {
  search: searchLocations, resolve: resolveLocationSelection,
  churchAddress: getChurchEventLocation, trackUsage: trackLocationUsage,
};

/** Keep a venue name while adding a properly formatted street address. */
export function EventLocationField({
  id,
  value,
  onChange,
  actions,
  name,
  maxLength = 500,
  provider = announcementLocations,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  actions?: ReactNode;
  name?: string;
  maxLength?: number;
  provider?: EventLocationProvider;
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
  const [resolving, setResolving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const session = useRef<string | undefined>(undefined);
  const selection = useRef(0);
  const choosing = useRef(false);
  const currentValue = useRef(value);
  currentValue.current = value;
  useEffect(() => () => { selection.current++; }, []);

  useEffect(() => {
    const query = value.trim();
    setSuggestions([]);
    setActiveIndex(-1);
    setMessage("");
    if (!query) session.current = undefined;
    if (!focused || query.length < 3 || value === selectedValue) { setLoading(false); return; }
    session.current ??= crypto.randomUUID();
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void provider.search(query, session.current).then((result) => {
        if (!active) return;
        setLoading(false);
        if (!result.ok) { setMessage(result.error); return; }
        setSuggestions(result.suggestions);
        const note = result.addressSearch === "unconfigured"
          ? "Address search hasn't been set up yet. You can still type the full address or use the church address."
          : result.addressSearch === "unavailable"
          ? "Address search is unavailable right now. You can still type the full address or use the church address."
          : !result.suggestions.length && !result.notice ? "No matching addresses. You can still type the full address." : "";
        setMessage([result.notice, note].filter(Boolean).join(" "));
      }).catch(() => {
        if (active) { setLoading(false); setMessage("Address suggestions couldn't load. You can still type the full address."); }
      });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [value, focused, selectedValue, provider]);

  const commit = (address: string) => {
    if (address.length > maxLength) {
      setMessage(`That address is too long. Use a shorter venue name and street address (up to ${maxLength} characters).`);
      return false;
    }
    onChange(address);
    setSelectedValue(address);
    setSuggestions([]);
    setFocused(false);
    setMessage("");
    session.current = undefined;
    return true;
  };

  const choose = async (suggestion: EventLocationSuggestion) => {
    if (choosing.current) return;
    const version = ++selection.current, before = value;
    choosing.current = true;
    setResolving(true);
    setMessage("");
    try {
      const result = suggestion.source === "google" && suggestion.placeId
        ? await provider.resolve(suggestion.placeId, session.current)
        : { ok: true as const, value: suggestion.value };
      if (selection.current !== version || currentValue.current !== before) return;
      if (!result.ok) { setMessage(result.error); return; }
      if (!commit(result.value)) return;
      // Google predictions are transient suggestions, not an automatic saved-location library.
      if (suggestion.source === "saved") void provider.trackUsage?.(result.value).catch(() => {});
    } catch {
      if (selection.current === version) setMessage("We couldn't load that address. Choose it again or enter the street address yourself.");
    } finally {
      if (selection.current === version) { choosing.current = false; setResolving(false); }
    }
  };

  const fillChurchAddress = async () => {
    const version = ++selection.current, before = value;
    choosing.current = false;
    setResolving(false);
    setChurchPending(true);
    setMessage("");
    try {
      const result = await provider.churchAddress();
      if (selection.current !== version || currentValue.current !== before) return;
      if (!result.ok) { setMessage(result.error); return; }
      commit(result.value);
    } catch { if (selection.current === version) setMessage("We couldn't load the church address. Type it here or try again."); }
    finally { if (selection.current === version) setChurchPending(false); }
  };

  const addAddress = () => {
    const line = formatAddressLine(address);
    if (!line) return;
    const fullLocation = [value.trim(), line].filter(Boolean).join(" · ");
    selection.current++;
    choosing.current = false;
    setResolving(false);
    setChurchPending(false);
    if (!commit(fullLocation)) return;
    void provider.trackUsage?.(fullLocation).catch(() => {});
    setAddingAddress(false);
    setAddress({ address: "", city: "", state: "", zip: "" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative">
      <MapPin className="pointer-events-none absolute left-3.5 top-3.5 size-5 text-muted-foreground" aria-hidden />
      <Input
        ref={inputRef}
        id={id}
        name={name}
        maxLength={maxLength}
        className="pl-11"
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => { selection.current++; choosing.current = false; setResolving(false); setChurchPending(false); onChange(event.target.value); setSelectedValue(null); setFocused(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && focused) { event.preventDefault(); event.stopPropagation(); setFocused(false); }
          if (!suggestions.length || !focused) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(index => event.key === "ArrowDown" ? (index + 1) % suggestions.length : (index < 1 ? suggestions.length - 1 : index - 1));
          } else if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            void choose(suggestions[activeIndex]);
          }
        }}
        placeholder="Search for an address or place"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={focused && suggestions.length > 0}
        aria-controls={`${id}-suggestions`}
        aria-activedescendant={focused && activeIndex >= 0 ? `${id}-suggestion-${activeIndex}` : undefined}
        aria-describedby={message ? `${id}-location-message` : `${id}-location-hint`}
        aria-busy={loading || resolving}
      />
      </div>
      <p id={`${id}-location-hint`} className="text-sm text-muted-foreground">Search for a place, then choose its address below.</p>
      {resolving ? <SkeletonContainer label="full address" className="rounded-xl border border-border p-3"><SkeletonText lines={2} /></SkeletonContainer> : null}
      {focused && loading ? <SkeletonContainer label="address suggestions" className="rounded-xl border border-border p-3"><SkeletonText lines={2} /></SkeletonContainer> : null}
      {focused && suggestions.length > 0 ? <ul id={`${id}-suggestions`} role="listbox" aria-label="Address suggestions" className="max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-sm">
        {suggestions.map((suggestion, index) => <li key={`${suggestion.source}-${suggestion.value}`} role="presentation">
          <button type="button" role="option" id={`${id}-suggestion-${index}`} aria-selected={activeIndex === index}
            tabIndex={-1} disabled={resolving || churchPending} onPointerDown={event => event.preventDefault()} onClick={() => { void choose(suggestion); }}
            className={`flex min-h-11 w-full flex-col items-start gap-1 rounded-lg px-3 py-2 text-left text-[15px] text-popover-foreground hover:bg-muted ${activeIndex === index ? "bg-muted" : ""}`}>
            <span className="break-words">{suggestion.value}</span>
            <span className="whitespace-nowrap text-xs font-normal text-muted-foreground" translate={suggestion.source === "google" ? "no" : undefined}>{suggestion.source === "google" ? "Google Maps" : suggestion.label}</span>
          </button>
        </li>)}
      </ul> : null}
      {selectedValue && value === selectedValue ? <div role="status" className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden />
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Location added</p><p className="break-words text-[15px]">{selectedValue}</p></div>
        <Button type="button" variant="ghost" size="sm" className="shrink-0 px-2" onClick={() => { selection.current++; onChange(""); setSelectedValue(null); setFocused(true); inputRef.current?.focus(); }}>Clear</Button>
      </div> : null}
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
        {actions ?? <Button type="button" variant="outline" size="sm" disabled={churchPending || resolving} onClick={() => { void fillChurchAddress(); }}>
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
