"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Crosshair, Minus, Plus } from "lucide-react";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  coordinateAtViewportPoint,
  metersPerPixel,
  tilesForViewport,
  zoomToFit,
} from "@/lib/maps/web-mercator";

const MAP_HEIGHT = 280;

/**
 * A campus, its check-in circle, and a pin a church admin can move.
 *
 * Plain OpenStreetMap tiles placed by hand (see `lib/maps/web-mercator.ts`):
 * no map library, no key, no account with a mapping company. The tiles are
 * fetched by the admin's browser from tile.openstreetmap.org, which asks for
 * attribution and light use; one person placing their church is both.
 *
 * Clicking moves the pin there and re-centres on it. With the map focused, the
 * arrow keys move the pin five metres (twenty-five with Shift), so it can be
 * placed without a mouse. The latitude and longitude fields beside the map
 * remain the precise way in; the map is how someone checks they are right.
 */
export function CampusRadiusMap({
  latitude,
  longitude,
  radiusMeters,
  onPick,
  disabled,
}: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onPick?: (point: { latitude: number; longitude: number }) => void;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [zoom, setZoom] = useState(() => zoomToFit(latitude, radiusMeters, MAP_HEIGHT));
  const [zoomTouched, setZoomTouched] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(200, Math.round(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the whole circle in view as the radius changes, until the admin
  // chooses a zoom themselves.
  useEffect(() => {
    if (!zoomTouched) setZoom(zoomToFit(latitude, radiusMeters, Math.min(width, MAP_HEIGHT)));
  }, [latitude, radiusMeters, width, zoomTouched]);

  const tiles = tilesForViewport({ latitude, longitude, zoom, width, height: MAP_HEIGHT });
  const radiusPixels = radiusMeters / metersPerPixel(latitude, zoom);

  const pickAt = (pointX: number, pointY: number) => {
    if (!onPick || disabled) return;
    const point = coordinateAtViewportPoint({
      center: { latitude, longitude },
      zoom,
      width,
      height: MAP_HEIGHT,
      pointX,
      pointY,
    });
    onPick({
      latitude: Math.round(point.latitude * 1e6) / 1e6,
      longitude: Math.round(point.longitude * 1e6) / 1e6,
    });
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pickAt(event.clientX - bounds.left, event.clientY - bounds.top);
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = (event.shiftKey ? 25 : 5) / metersPerPixel(latitude, zoom);
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    pickAt(width / 2 + move[0], MAP_HEIGHT / 2 + move[1]);
  };

  const changeZoom = (delta: number) => {
    setZoomTouched(true);
    setZoom((current) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current + delta)));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border border-border bg-muted"
        style={{ height: MAP_HEIGHT }}
      >
        <div
          role="application"
          aria-label={`Map of the campus. The check-in area is a ${radiusMeters} metre circle. ${
            onPick && !disabled
              ? "Click to move the pin, or use the arrow keys."
              : ""
          }`}
          tabIndex={onPick && !disabled ? 0 : -1}
          onClick={handleClick}
          onKeyDown={handleKey}
          className={`absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            onPick && !disabled ? "cursor-crosshair" : ""
          }`}
        >
          {tiles.map((tile) => (
            // eslint-disable-next-line @next/next/no-img-element -- OpenStreetMap tiles are placed by hand; next/image would proxy and resize them
            <img
              key={tile.key}
              src={tile.url}
              alt=""
              width={256}
              height={256}
              draggable={false}
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute max-w-none select-none"
              style={{ left: tile.left, top: tile.top, width: 256, height: 256 }}
            />
          ))}

          <svg
            className="pointer-events-none absolute inset-0"
            width={width}
            height={MAP_HEIGHT}
            aria-hidden
          >
            <circle
              cx={width / 2}
              cy={MAP_HEIGHT / 2}
              r={Math.max(4, radiusPixels)}
              className="fill-sky-500/20 stroke-sky-600"
              strokeWidth={2}
            />
            <circle
              cx={width / 2}
              cy={MAP_HEIGHT / 2}
              r={5}
              className="fill-white stroke-sky-700"
              strokeWidth={2.5}
            />
          </svg>
        </div>

        <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-sm">
          <button
            type="button"
            className="flex size-8 items-center justify-center hover:bg-muted disabled:opacity-40"
            onClick={() => changeZoom(1)}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <Plus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className="flex size-8 items-center justify-center border-t border-border hover:bg-muted disabled:opacity-40"
            onClick={() => changeZoom(-1)}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className="flex size-8 items-center justify-center border-t border-border hover:bg-muted"
            onClick={() => setZoomTouched(false)}
            aria-label="Fit the check-in area"
          >
            <Crosshair className="size-4" aria-hidden />
          </button>
        </div>

        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-0 right-0 rounded-tl bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          © OpenStreetMap contributors
        </a>
      </div>
    </div>
  );
}
