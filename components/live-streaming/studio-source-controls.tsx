"use client";

import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUpLeft,
  ArrowUpRight,
  Camera,
  Loader2,
  MonitorUp,
  Square,
  Video,
} from "lucide-react";
import type { PipCorner, StudioLayout } from "@/lib/stream/studio-compositor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LAYOUTS: {
  id: StudioLayout;
  label: string;
  shortLabel: string;
  icon: typeof Camera;
}[] = [
  { id: "camera", label: "Camera", shortLabel: "Camera", icon: Camera },
  { id: "screen", label: "Screen", shortLabel: "Screen", icon: MonitorUp },
  {
    id: "screenWithCamera",
    label: "Screen + camera",
    shortLabel: "Screen + cam",
    icon: Video,
  },
];

const CORNERS: { id: PipCorner; label: string; icon: typeof ArrowDownRight }[] =
  [
    { id: "top-left", label: "Top left", icon: ArrowUpLeft },
    { id: "top-right", label: "Top right", icon: ArrowUpRight },
    { id: "bottom-left", label: "Bottom left", icon: ArrowDownLeft },
    { id: "bottom-right", label: "Bottom right", icon: ArrowDownRight },
  ];

type StudioSourceControlsProps = {
  isLive: boolean;
  layout: StudioLayout;
  pipCorner: PipCorner;
  publishing: boolean;
  micLevel: number;
  hasLogo: boolean;
  onStartStudio: () => void;
  onStopStudio: () => void;
  onSwitchLayout: (layout: StudioLayout) => void;
  onSetPipCorner: (corner: PipCorner) => void;
};

export function layoutLabel(layout: StudioLayout): string {
  return LAYOUTS.find((l) => l.id === layout)?.label ?? layout;
}

export function StudioSourceControls({
  isLive,
  layout,
  pipCorner,
  publishing,
  micLevel,
  hasLogo,
  onStartStudio,
  onStopStudio,
  onSwitchLayout,
  onSetPipCorner,
}: StudioSourceControlsProps) {
  return (
    <div className="space-y-4">
      {!isLive ? (
        <Button
          type="button"
          className="gap-2"
          disabled={publishing}
          onClick={() => void onStartStudio()}
        >
          {publishing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Video className="size-4" />
          )}
          Start studio
        </Button>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Source
            </p>
            <div
              className="inline-flex rounded-lg border border-border bg-muted/30 p-1"
              role="group"
              aria-label="Studio layout"
            >
              {LAYOUTS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={publishing}
                  onClick={() => void onSwitchLayout(id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    layout === id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                    publishing && "opacity-60",
                  )}
                >
                  {publishing && layout === id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {layout === "screenWithCamera" ? (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Camera position
              </p>
              <div
                className="inline-flex rounded-lg border border-border bg-muted/30 p-1"
                role="group"
                aria-label="PiP corner"
              >
                {CORNERS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    title={label}
                    disabled={publishing}
                    onClick={() => onSetPipCorner(id)}
                    className={cn(
                      "rounded-md p-2 transition-colors",
                      pipCorner === id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="sr-only">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex min-w-[140px] flex-1 items-center gap-2">
              <span className="text-xs text-muted-foreground">Mic</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-75"
                  style={{ width: `${Math.min(100, micLevel * 140)}%` }}
                />
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={onStopStudio}
            >
              <Square className="size-4" />
              Stop studio
            </Button>
          </div>
        </>
      )}

      {!hasLogo && isLive ? (
        <p className="text-xs text-muted-foreground">
          Add a church logo in Settings for a branded watermark on your stream.
        </p>
      ) : null}
    </div>
  );
}
