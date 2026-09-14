"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import {
  findAddress,
  saveCampusLocation,
} from "@/app/dashboard/attendance/setup/actions";
import type { GeocodeMatch } from "@/lib/attendance/v2/geocode";
import type { SetupCampus } from "@/lib/attendance/v2/setup";
import { GEOFENCE_RADIUS_BOUNDS } from "@/lib/attendance/v2/setup-bounds";
import { CampusRadiusMap } from "@/components/attendance/campus-radius-map";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RADIUS_MIN = GEOFENCE_RADIUS_BOUNDS.min;
const RADIUS_MAX = GEOFENCE_RADIUS_BOUNDS.max;
const RADIUS_PRESETS = [
  { meters: 100, label: "Small building" },
  { meters: 150, label: "Church and parking" },
  { meters: 250, label: "Large campus" },
];

function parseCoordinate(value: string, bound: number): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= bound ? parsed : null;
}

/**
 * Where one campus is, and how far around it counts as arriving.
 *
 * Three ways in, any of which fills the other two: search for the address, drop
 * the pin on the map, or type coordinates copied from a map app. The circle on
 * the map is exactly what the phones are told to watch, so a church can see
 * whether its car park is inside it.
 */
export function CampusLocationEditor({
  campus,
  onSaved,
  onCancel,
}: {
  campus: SetupCampus;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(campus.address ?? "");
  const [matches, setMatches] = useState<GeocodeMatch[] | null>(null);
  const [latitude, setLatitude] = useState(
    campus.latitude === null ? "" : String(campus.latitude),
  );
  const [longitude, setLongitude] = useState(
    campus.longitude === null ? "" : String(campus.longitude),
  );
  const [radius, setRadius] = useState(
    Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, campus.radiusMeters || 150)),
  );

  const lat = parseCoordinate(latitude, 90);
  const lng = parseCoordinate(longitude, 180);
  const positioned = lat !== null && lng !== null && !(lat === 0 && lng === 0);

  const search = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await findAddress(query);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setMatches(result.data);
      if (result.data.length === 1) choose(result.data[0]);
    });
  };

  const choose = (match: GeocodeMatch) => {
    setLatitude(String(Math.round(match.latitude * 1e6) / 1e6));
    setLongitude(String(Math.round(match.longitude * 1e6) / 1e6));
  };

  const save = () => {
    if (!positioned) {
      toast.error("Set the location first: search, click the map, or enter coordinates.");
      return;
    }
    startTransition(async () => {
      const result = await saveCampusLocation({
        campusId: campus.id,
        values: { latitude: lat, longitude: lng, radiusMeters: radius },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`${campus.name} location saved.`);
      onSaved();
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-accent/40 bg-accent/5 p-4">
      <form onSubmit={search} className="flex flex-col gap-2">
        <Label htmlFor={`campus-search-${campus.id}`} className="text-xs font-semibold">
          Find the address
        </Label>
        <div className="flex gap-2">
          <Input
            id={`campus-search-${campus.id}`}
            value={query}
            maxLength={300}
            placeholder="123 Main Street, Springfield"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={pending || query.trim().length < 3}>
            <Search className="size-4" aria-hidden />
            Find
          </Button>
        </div>
        {matches && matches.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No match. Try the street and city, or click the building on the map.
          </p>
        )}
        {matches && matches.length > 1 && (
          <ul className="flex flex-col gap-1" aria-label="Addresses found">
            {matches.map((match) => (
              <li key={`${match.latitude},${match.longitude}`}>
                <button
                  type="button"
                  onClick={() => choose(match)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-xs hover:border-accent"
                >
                  {match.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {positioned ? (
        <CampusRadiusMap
          latitude={lat}
          longitude={lng}
          radiusMeters={radius}
          disabled={pending}
          onPick={(point) => {
            setLatitude(String(point.latitude));
            setLongitude(String(point.longitude));
          }}
        />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
          Search for the address or enter coordinates, and the map appears here
          so you can move the pin onto the building.
        </div>
      )}
      {positioned && (
        <p className="text-xs text-muted-foreground">
          Click the map to move the pin to the main entrance. The shaded circle is
          where arriving counts. Map data from OpenStreetMap.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`campus-lat-${campus.id}`} className="text-xs font-semibold">
            Latitude
          </Label>
          <Input
            id={`campus-lat-${campus.id}`}
            value={latitude}
            inputMode="decimal"
            placeholder="38.252700"
            onChange={(event) => setLatitude(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`campus-lng-${campus.id}`} className="text-xs font-semibold">
            Longitude
          </Label>
          <Input
            id={`campus-lng-${campus.id}`}
            value={longitude}
            inputMode="decimal"
            placeholder="-85.758500"
            onChange={(event) => setLongitude(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`campus-radius-${campus.id}`} className="text-xs font-semibold">
            Check-in area
          </Label>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {radius} m around the pin
          </span>
        </div>
        <input
          id={`campus-radius-${campus.id}`}
          type="range"
          min={RADIUS_MIN}
          max={RADIUS_MAX}
          step={10}
          value={radius}
          onChange={(event) => setRadius(Number(event.target.value))}
          className="w-full accent-accent"
          aria-valuetext={`${radius} metres`}
        />
        <div className="flex flex-wrap gap-2">
          {RADIUS_PRESETS.map((preset) => (
            <button
              key={preset.meters}
              type="button"
              onClick={() => setRadius(preset.meters)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                radius === preset.meters
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-accent/50"
              }`}
            >
              {preset.meters} m · {preset.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          50 to 500 metres. Big enough to include where people park, so they are
          counted while walking in; small enough to leave out the houses and
          shops next door. 150 m suits most churches.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={pending || !positioned}>
          {pending ? "Saving…" : "Save location"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
