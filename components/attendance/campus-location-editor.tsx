"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Crosshair, LocateFixed, MapPin, Search } from "lucide-react";
import { toast } from "sonner";

import {
  findAddress,
  saveCampusLocation,
} from "@/app/dashboard/attendance/setup/actions";
import type { GeocodeMatch } from "@/lib/attendance/v2/geocode";
import type { SetupCampus } from "@/lib/attendance/v2/setup";
import { GEOFENCE_RADIUS_BOUNDS } from "@/lib/attendance/v2/setup-bounds";
import { RADIUS_PRESETS } from "@/lib/attendance/v2/setup-view";
import { CampusRadiusMap } from "@/components/attendance/campus-radius-map";
import { Segmented } from "@/components/attendance/setup-step";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RADIUS_MIN = GEOFENCE_RADIUS_BOUNDS.min;
const RADIUS_MAX = GEOFENCE_RADIUS_BOUNDS.max;

function parseCoordinate(value: string, bound: number): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= bound ? parsed : null;
}

function roundCoordinate(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

/**
 * Where one campus is, and how far around it counts as arriving.
 *
 * Fastest first. Standing in the building, "Use my current location" is one
 * tap. Otherwise the church's own address is looked up as soon as the editor
 * opens, so most churches only have to check the pin is on their building.
 * Searching, clicking the map and typing coordinates remain for everything
 * else. The circle on the map is exactly what phones are told to watch.
 *
 * "Use my current location" reads the *admin's* browser position once, when
 * they tap it, to place the church — the same as dropping a pin by hand. It is
 * never read otherwise, and nothing about the people who attend is involved.
 */
export function CampusLocationEditor({
  campus,
  churchAddress,
  onSaved,
  onCancel,
}: {
  campus: SetupCampus;
  /** The church's profile address, used when the campus has none of its own. */
  churchAddress?: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const knownAddress = campus.address ?? churchAddress ?? "";
  const [query, setQuery] = useState(knownAddress);
  const [matches, setMatches] = useState<GeocodeMatch[] | null>(null);
  const [latitude, setLatitude] = useState(
    campus.latitude === null ? "" : String(campus.latitude),
  );
  const [longitude, setLongitude] = useState(
    campus.longitude === null ? "" : String(campus.longitude),
  );
  const [radius, setRadius] = useState(
    Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, campus.radiusMeters || GEOFENCE_RADIUS_BOUNDS.default)),
  );
  const [locating, setLocating] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  const lat = parseCoordinate(latitude, 90);
  const lng = parseCoordinate(longitude, 180);
  const positioned = lat !== null && lng !== null && !(lat === 0 && lng === 0);

  const choose = (match: GeocodeMatch) => {
    setLatitude(roundCoordinate(match.latitude));
    setLongitude(roundCoordinate(match.longitude));
    setSource(`Found ${match.label.split(",").slice(0, 3).join(",")}.`);
  };

  const runSearch = (text: string) => {
    startTransition(async () => {
      const result = await findAddress(text);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setMatches(result.data);
      if (result.data.length >= 1) choose(result.data[0]);
    });
  };

  // A campus with an address and no pin: look the address up straight away,
  // so the first thing an admin sees is their building with a circle round it.
  const lookedUp = useRef(false);
  useEffect(() => {
    if (lookedUp.current || positioned || knownAddress.trim().length < 3) return;
    lookedUp.current = true;
    runSearch(knownAddress);
    // Once, on opening. The dependencies are deliberately empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = (event: FormEvent) => {
    event.preventDefault();
    runSearch(query);
  };

  const locateMe = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      toast.error("This browser can't share its location. Search for the address instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setLatitude(roundCoordinate(position.coords.latitude));
        setLongitude(roundCoordinate(position.coords.longitude));
        setMatches(null);
        const accuracy = Math.round(position.coords.accuracy);
        setSource(
          accuracy > 75
            ? `Placed where you are, to within about ${accuracy} m. Move the pin onto the building if it's off.`
            : `Placed where you are, to within about ${accuracy} m.`,
        );
      },
      (error) => {
        setLocating(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was turned down. Allow it for this site, or search for the address."
            : "Couldn't find where you are. Try again, or search for the address.",
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const save = () => {
    if (!positioned) {
      toast.error("Place the church first: use your location, search, or click the map.");
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
      toast.success(`${campus.name} is on the map.`);
      onSaved();
    });
  };

  const radiusOptions = RADIUS_PRESETS.map((preset) => ({
    value: preset.meters as number,
    label: `${preset.meters} m`,
    hint: preset.label,
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="h-auto justify-start gap-3 whitespace-normal py-3 text-left"
          onClick={locateMe}
          disabled={pending || locating}
        >
          <LocateFixed className="size-5 shrink-0 text-accent" aria-hidden />
          <span className="flex flex-col">
            <span className="font-semibold">
              {locating ? "Finding you…" : "Use my current location"}
            </span>
            <span className="text-sm font-normal text-muted-foreground">
              Best when you&apos;re standing inside the building
            </span>
          </span>
        </Button>
        {knownAddress ? (
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start gap-3 whitespace-normal py-3 text-left"
            onClick={() => {
              setQuery(knownAddress);
              runSearch(knownAddress);
            }}
            disabled={pending}
          >
            <MapPin className="size-5 shrink-0 text-accent" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold">Use the church address</span>
              <span className="truncate text-sm font-normal text-muted-foreground">
                {knownAddress}
              </span>
            </span>
          </Button>
        ) : null}
      </div>

      <form onSubmit={search} className="flex flex-col gap-2">
        <Label htmlFor={`campus-search-${campus.id}`} className="text-[15px] font-semibold">
          Or search for an address
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
          <p className="text-sm text-muted-foreground">
            No match. Try just the street and city, or click the building on the map.
          </p>
        )}
        {matches && matches.length > 1 && (
          <ul className="flex flex-col gap-1" aria-label="Addresses found">
            {matches.map((match) => {
              const chosen =
                roundCoordinate(match.latitude) === latitude &&
                roundCoordinate(match.longitude) === longitude;
              return (
                <li key={`${match.latitude},${match.longitude}`}>
                  <button
                    type="button"
                    onClick={() => choose(match)}
                    aria-pressed={chosen}
                    className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      chosen
                        ? "border-accent bg-brand-gold/10 text-foreground"
                        : "border-border bg-background hover:border-brand-gold/60"
                    }`}
                  >
                    {match.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </form>

      {positioned ? (
        <div className="flex flex-col gap-2">
          <CampusRadiusMap
            latitude={lat}
            longitude={lng}
            radiusMeters={radius}
            disabled={pending}
            onPick={(point) => {
              setLatitude(String(point.latitude));
              setLongitude(String(point.longitude));
              setSource("Pin moved on the map.");
            }}
          />
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Crosshair className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {source ? `${source} ` : ""}
              Click the map to put the pin on the main entrance. Anyone who
              arrives inside the circle counts as here.
            </span>
          </p>
        </div>
      ) : (
        <div className="flex h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
          <MapPin className="size-6 text-muted-foreground" aria-hidden />
          {pending
            ? "Looking up the address…"
            : "Use your location or search for the address, and your building appears here."}
        </div>
      )}

      <AdvancedSection
        title="Fine-tune the location"
        description={`How close counts as "here" (now ${radius} metres), or type exact map coordinates.`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-foreground">How close counts as &ldquo;here&rdquo;</span>
            <span className="text-[15px] font-semibold tabular-nums text-foreground">{radius} metres</span>
          </div>
          {radius < 100 ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              This is small for phones to notice reliably, especially indoors. 100 to 150
              metres works better, with the pin on the building.
            </p>
          ) : null}
          <Segmented
            label="How close counts as here"
            options={
              radiusOptions.some((option) => option.value === radius)
                ? radiusOptions
                : [...radiusOptions, { value: radius, label: `${radius} m`, hint: "Custom" }]
            }
            value={radius}
            onChange={setRadius}
            disabled={pending}
          />
          <input
            id={`campus-radius-${campus.id}`}
            type="range"
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={10}
            value={radius}
            onChange={(event) => setRadius(Number(event.target.value))}
            className="h-11 w-full accent-accent"
            aria-label="How close counts as here, in metres"
            aria-valuetext={`${radius} metres`}
          />
          <p className="text-sm text-muted-foreground">
            Big enough to include the parking lot, so people are counted as they
            walk in; small enough to leave out the neighbours. 150 metres suits
            most churches.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-5">
          <p className="text-[15px] font-semibold text-foreground">Enter coordinates instead</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`campus-lat-${campus.id}`} className="text-sm font-semibold">
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
              <Label htmlFor={`campus-lng-${campus.id}`} className="text-sm font-semibold">
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
        </div>
      </AdvancedSection>

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
