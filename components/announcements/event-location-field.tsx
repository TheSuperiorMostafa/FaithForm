"use client";

import { useState, useEffect, useCallback } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAddressLine } from "@/lib/utils/address";
import { searchLocations, trackLocationUsage } from "@/app/dashboard/announcements/location-actions";

/** Keep a venue name while adding a properly formatted street address. */
export function EventLocationField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const [addingAddress, setAddingAddress] = useState(false);
  const [address, setAddress] = useState({ address: "", city: "", state: "", zip: "" });
  const [suggestions, setSuggestions] = useState<Array<{ label: string; value: string }>>([]);
  const [loading, setLoading] = useState(false);
  
  const loadSuggestions = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    
    setLoading(true);
    try {
      const result = await searchLocations(query);
      if (result.ok) {
        setSuggestions(result.suggestions);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSuggestions(value);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [value, loadSuggestions]);
  
  const handleSelect = (selected: string) => {
    onChange(selected);
    void trackLocationUsage(selected);
  };
  
  const addAddress = () => {
    const line = formatAddressLine(address);
    if (!line) return;
    const fullLocation = [value.trim(), line].filter(Boolean).join(" · ");
    onChange(fullLocation);
    void trackLocationUsage(fullLocation);
    setAddingAddress(false);
    setAddress({ address: "", city: "", state: "", zip: "" });
  };
  
  return <div className="flex min-w-0 flex-1 flex-col gap-3">
    <div className="relative">
      <Input 
        id={id} 
        value={value} 
        onChange={(event) => onChange(event.target.value)} 
        placeholder="Venue name or street address" 
        autoComplete="off"
        list={`${id}-suggestions`}
      />
      {suggestions.length > 0 && (
        <datalist id={`${id}-suggestions`}>
          {suggestions.map((suggestion, i) => (
            <option key={i} value={suggestion.value}>
              {suggestion.label}
            </option>
          ))}
        </datalist>
      )}
    </div>
    <Button type="button" variant="outline" className="self-start" onClick={() => setAddingAddress((open) => !open)} aria-expanded={addingAddress}><MapPin className="size-4" aria-hidden />{addingAddress ? "Close address" : "Add street address"}</Button>
    {addingAddress && <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
      {([{ key: "address", label: "Street address", complete: "address-line1" }, { key: "city", label: "City", complete: "address-level2" }, { key: "state", label: "State or province", complete: "address-level1" }, { key: "zip", label: "ZIP or postal code", complete: "postal-code" }] as const).map((field) => <div key={field.key} className={field.key === "address" ? "space-y-2 sm:col-span-2" : "space-y-2"}><Label htmlFor={`${id}-${field.key}`}>{field.label}</Label><Input id={`${id}-${field.key}`} autoComplete={field.complete} value={address[field.key]} onChange={(event) => setAddress((current) => ({ ...current, [field.key]: event.target.value }))} /></div>)}
      <Button type="button" variant="outline" className="sm:col-span-2" disabled={!address.address.trim()} onClick={addAddress}>Use this address</Button>
    </div>}
  </div>;
}
