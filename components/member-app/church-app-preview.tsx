"use client";

import { useMemo, useState } from "react";
import {
  AtSign,
  Camera,
  Check,
  ChevronLeft,
  Clock,
  ExternalLink,
  Globe,
  Link2,
  Mail,
  MapPin,
  Mic,
  MonitorPlay,
  Music,
  Phone,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  normalizeSocialUrl,
  normalizeWebUrl,
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/lib/faithform/church-links";
import { formatServiceTime, nextService } from "@/lib/faithform/next-service";
import type { ChurchAppInfo, ChurchAppInfoContext } from "@/lib/queries/church-app-info";
import { cn } from "@/lib/utils";

/**
 * A live, to-scale picture of the church's page in the member app.
 *
 * It mirrors the phone layout section for section — hero, quick actions, next
 * service, times, about, connect, links, contact — and hides exactly what the
 * phones hide when a field is empty, so what a church sees here is what their
 * people will see.
 */

export const SOCIAL_STYLE: Record<SocialPlatformKey, { icon: LucideIcon; color: string }> = {
  instagram: { icon: Camera, color: "#E1306C" },
  facebook: { icon: Users, color: "#1877F2" },
  youtube: { icon: MonitorPlay, color: "#FF0000" },
  tiktok: { icon: Music, color: "#111111" },
  x: { icon: AtSign, color: "#111111" },
  podcast: { icon: Mic, color: "#8E44EF" },
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function relativeDay(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway} days`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type Mode = "home" | "search";

export function ChurchAppPreview({
  info,
  context,
}: {
  info: ChurchAppInfo;
  context: ChurchAppInfoContext;
}) {
  const [mode, setMode] = useState<Mode>("home");
  const [expanded, setExpanded] = useState(false);

  const accent = context.accentColor || context.primaryColor || "#3B5BDB";
  const deep = `color-mix(in oklab, ${accent} 62%, black)`;

  const services = useMemo(
    () =>
      info.serviceTimes
        .filter((row) => row.label.trim() && /^\d{2}:\d{2}/.test(row.startTime))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)),
    [info.serviceTimes],
  );
  const next = useMemo(() => nextService(services, context.timezone), [services, context.timezone]);

  const socials = SOCIAL_PLATFORMS.flatMap((platform) => {
    const url = normalizeSocialUrl(platform.key, info.social[platform.key]);
    return url ? [{ ...platform, url }] : [];
  });
  const links = info.quickLinks.flatMap((link) => {
    const url = normalizeWebUrl(link.url);
    return link.label.trim() && url ? [{ label: link.label.trim(), url }] : [];
  });

  const addressLine = [info.address, info.city, [info.state, info.zip].filter(Boolean).join(" ")]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  const website = normalizeWebUrl(info.website);
  const actions = [
    (addressLine || normalizeWebUrl(info.mapsUrl)) && { icon: MapPin, label: "Directions" },
    info.phone.trim() && { icon: Phone, label: "Call" },
    info.email.trim() && { icon: Mail, label: "Email" },
    website && { icon: Globe, label: "Website" },
  ].filter(Boolean) as { icon: LucideIcon; label: string }[];

  const subtitle = [context.denomination, [info.city, info.state].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");
  const name = info.name.trim() || "Your church";
  const about = info.about.trim();

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        role="radiogroup"
        aria-label="Preview as"
        className="inline-flex rounded-full border border-border bg-muted/50 p-1 text-xs font-semibold"
      >
        {(
          [
            ["home", "Your people"],
            ["search", "Someone new"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "rounded-full px-3.5 py-1.5 transition-colors",
              mode === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Device */}
      <div className="relative w-[340px] rounded-[54px] bg-neutral-900 p-[11px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] ring-1 ring-black/10">
        <div
          className="relative h-[690px] overflow-hidden rounded-[44px] bg-[#F4F4F7] text-[#111] dark:bg-[#0B0B0F] dark:text-white dark:[--pv-ink:color-mix(in_oklab,var(--pv-accent)_55%,white)]"
          style={{ "--pv-accent": accent, "--pv-ink": accent } as React.CSSProperties}
        >
          <div
            className="h-full overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label={`Preview of ${name} in the app`}
          >
            {/* Hero */}
            <div className="relative h-[270px] w-full overflow-hidden">
              {info.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={info.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div
                  className="absolute inset-0"
                  style={{
                    background: `radial-gradient(120% 80% at 85% 0%, color-mix(in oklab, ${accent} 55%, white) 0%, transparent 55%), linear-gradient(160deg, ${accent} 0%, ${deep} 100%)`,
                  }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/75" />

              {/* Status bar + nav */}
              <div className="absolute inset-x-0 top-0 flex items-center justify-between px-7 pt-3.5 text-[13px] font-semibold text-white">
                <span>9:41</span>
                <span className="h-[26px] w-[92px] rounded-full bg-black" aria-hidden />
                <span className="tracking-tight">●●● ▮</span>
              </div>
              <div className="absolute left-4 top-12 flex size-9 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md">
                <ChevronLeft className="size-5" aria-hidden />
              </div>

              <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 px-5 pb-11">
                <div className="size-[60px] shrink-0 overflow-hidden rounded-full bg-white shadow-lg ring-[3px] ring-white">
                  {info.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={info.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center text-xl font-bold text-white"
                      style={{ background: accent }}
                    >
                      {name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 pb-0.5 text-white">
                  <p className="line-clamp-2 text-[22px] font-extrabold leading-tight tracking-tight drop-shadow">
                    {name}
                  </p>
                  {info.tagline.trim() && (
                    <p className="mt-0.5 line-clamp-1 text-[13px] font-medium text-white/85">
                      {info.tagline}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Glass quick actions */}
            <div className="relative z-10 -mt-7 px-4">
              {actions.length > 0 ? (
                <div
                  className="grid gap-1 rounded-[22px] border border-white/70 bg-white/80 p-2 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-white/10"
                  style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}
                >
                  {actions.map(({ icon: Icon, label }) => (
                    <div key={label} className="flex flex-col items-center gap-1 rounded-2xl py-2">
                      <span
                        className="flex size-9 items-center justify-center rounded-full"
                        style={{ background: `color-mix(in oklab, ${accent} 14%, transparent)`, color: "var(--pv-ink)" }}
                      >
                        <Icon className="size-[18px]" aria-hidden />
                      </span>
                      <span className="text-[11px] font-semibold">{label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-7" />
              )}
            </div>

            <div className="flex flex-col gap-3.5 px-4 pb-28 pt-4">
              {subtitle && <p className="px-1 text-[12px] font-medium text-black/50 dark:text-white/50">{subtitle}</p>}

              {mode === "home" && (
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
                  style={{ background: `color-mix(in oklab, ${accent} 14%, transparent)`, color: "var(--pv-ink)" }}>
                  <Check className="size-3.5" aria-hidden /> Your church
                </span>
              )}

              {/* Next service */}
              {next && (
                <div
                  className="relative overflow-hidden rounded-[20px] p-4 text-white shadow-[0_12px_30px_-14px_rgba(0,0,0,0.5)]"
                  style={{ background: `linear-gradient(135deg, ${accent} 0%, ${deep} 100%)` }}
                >
                  <div className="absolute -right-6 -top-10 size-32 rounded-full bg-white/15 blur-2xl" aria-hidden />
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/75">Next service</p>
                  <p className="mt-1 text-[22px] font-extrabold leading-tight">
                    {DAY_NAMES[next.service.dayOfWeek]} · {formatServiceTime(next.service.startTime)}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <p className="line-clamp-1 text-[13px] text-white/85">{next.service.label}</p>
                    <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold backdrop-blur">
                      {relativeDay(next.daysAway)}
                    </span>
                  </div>
                </div>
              )}

              {services.length > 1 && (
                <PreviewCard title="Service times">
                  {services.map((row) => (
                    <div key={row.clientId} className="flex items-center gap-3 py-2">
                      <Clock className="size-4 shrink-0 opacity-45" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold">
                          {DAY_NAMES[row.dayOfWeek]} · {formatServiceTime(row.startTime)}
                        </p>
                        <p className="truncate text-[11px] opacity-55">{row.label}</p>
                      </div>
                    </div>
                  ))}
                </PreviewCard>
              )}

              {about && (
                <PreviewCard title="About">
                  <p className={cn("whitespace-pre-line text-[13px] leading-relaxed opacity-80", !expanded && "line-clamp-5")}>
                    {about}
                  </p>
                  {about.length > 220 && (
                    <button
                      type="button"
                      onClick={() => setExpanded((value) => !value)}
                      className="mt-1 text-[12px] font-bold"
                      style={{ color: "var(--pv-ink)" }}
                    >
                      {expanded ? "Show less" : "Read more"}
                    </button>
                  )}
                </PreviewCard>
              )}

              {socials.length > 0 && (
                <div>
                  <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider opacity-45">Connect</p>
                  <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                    {socials.map((social) => {
                      const style = SOCIAL_STYLE[social.key];
                      return (
                        <div key={social.key} className="flex w-[58px] shrink-0 flex-col items-center gap-1.5">
                          <span
                            className="flex size-[50px] items-center justify-center rounded-full text-white shadow-md"
                            style={{ background: style.color }}
                          >
                            <style.icon className="size-5" aria-hidden />
                          </span>
                          <span className="text-[10.5px] font-semibold opacity-70">{social.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {links.length > 0 && (
                <PreviewCard title="Links">
                  {links.map((link) => (
                    <div key={`${link.label}-${link.url}`} className="flex items-center gap-3 py-2">
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-[10px]"
                        style={{ background: `color-mix(in oklab, ${accent} 14%, transparent)`, color: "var(--pv-ink)" }}
                      >
                        <Link2 className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold">{link.label}</p>
                        <p className="truncate text-[11px] opacity-50">{hostOf(link.url)}</p>
                      </div>
                      <ExternalLink className="size-3.5 shrink-0 opacity-35" aria-hidden />
                    </div>
                  ))}
                </PreviewCard>
              )}

              {(info.phone.trim() || info.email.trim() || website || addressLine) && (
                <PreviewCard title="Contact">
                  {[
                    addressLine && ["Address", addressLine],
                    info.phone.trim() && ["Phone", info.phone.trim()],
                    info.email.trim() && ["Email", info.email.trim()],
                    website && ["Website", hostOf(website)],
                  ]
                    .filter(Boolean)
                    .map((row) => {
                      const [label, value] = row as [string, string];
                      return (
                        <div key={label} className="flex items-start justify-between gap-3 py-2">
                          <span className="text-[11px] font-semibold opacity-50">{label}</span>
                          <span className="text-right text-[12.5px] font-medium" style={label === "Address" ? undefined : { color: "var(--pv-ink)" }}>
                            {value}
                          </span>
                        </div>
                      );
                    })}
                </PreviewCard>
              )}

              {mode === "home" && (
                <div className="flex flex-col items-center gap-2 pt-1">
                  <span className="w-full rounded-full border border-black/15 py-2.5 text-center text-[13px] font-bold dark:border-white/20">
                    Change church
                  </span>
                  <span className="text-[12px] font-bold text-[#D92D20]">Remove church</span>
                </div>
              )}
            </div>
          </div>

          {/* Sticky add bar for someone evaluating the church */}
          {mode === "search" && (
            <div className="absolute inset-x-0 bottom-0 border-t border-black/5 bg-white/85 px-4 pb-7 pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-black/60">
              <div className="rounded-full py-3 text-center text-[14px] font-bold text-white shadow-lg" style={{ background: accent }}>
                Add church
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[120px] -translate-x-1/2 rounded-full bg-black/80 dark:bg-white/70" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function PreviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider opacity-45">{title}</p>
      <div className="divide-y divide-black/5 rounded-[20px] bg-white px-4 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:divide-white/10 dark:bg-white/[0.06]">
        {children}
      </div>
    </div>
  );
}
