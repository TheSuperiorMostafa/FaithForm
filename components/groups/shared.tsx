"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, BarChart3, CalendarDays, Check, ChevronLeft, Inbox, LayoutGrid, Loader2, MessageCircle, Search, Settings2, ShieldCheck, UsersRound, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { confirmAction } from "@/components/ui/confirm-dialog";
import type { StaffActionResult } from "@/lib/groups/staff/context";
import { groupInitials } from "@/lib/groups/types";
import { cn } from "@/lib/utils";

export const base = "/dashboard/groups";
export function date(value: string | null, timezone?: string) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(value)) : "Not yet"; }
export function dateTime(value: string, timezone?: string) { return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timezone ? { timeZone: timezone, timeZoneName: "short" } : {}) }).format(new Date(value)); }

/**
 * Runs a Groups server action: pending state, the plain-language error the
 * action returned, a success toast that names what happened, and a refresh.
 */
export function useGroupAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  function run<T>(operation: () => Promise<StaffActionResult<T>>, message?: string | ((data: T) => string), done?: (data: T) => void) {
    setError(null);
    start(async () => {
      try {
        const result = await operation();
        if (!result.ok) { setError(result.error); return; }
        if (message) toast.success(typeof message === "function" ? message(result.data) : message);
        done?.(result.data);
        router.refresh();
      } catch { setError("We couldn’t reach FaithForm, so nothing was changed. Check your connection and try again."); }
    });
  }
  return { pending, error, setError, run };
}

export function Notice({ children, tone = "attention" }: { children: ReactNode; tone?: "attention" | "info" }) {
  return <div role={tone === "attention" ? "alert" : "note"} className={cn("g-notice", tone === "info" && "g-notice-info")}>{children}</div>;
}
export function Submit({ pending, children = "Save changes", pendingLabel = "Saving…" }: { pending: boolean; children?: ReactNode; pendingLabel?: string }) {
  return <Button type="submit" disabled={pending}>{pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}{pending ? pendingLabel : children}</Button>;
}
export function Field({ label: title, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={cn("g-field", className)}><span>{title}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Toggle({ name, title, description, checked = false, disabled = false }: { name: string; title: string; description?: string; checked?: boolean; disabled?: boolean }) {
  return <label className="g-toggle"><span><strong>{title}</strong>{description && <small>{description}</small>}</span><input type="checkbox" name={name} defaultChecked={checked} disabled={disabled} /></label>;
}

/**
 * The Groups dialog. Anything typed into it is protected: once the form has
 * changes, a stray click outside does nothing, and Escape or the close button
 * asks "Discard changes?" first. Closing after a successful save goes through
 * `onClose` directly and never asks.
 */
export function Modal({ title, description, open, onClose, children, wide = false, dirty }: { title: string; description?: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; dirty?: boolean }) {
  const id = useId();
  const [typed, setTyped] = useState(false);
  useEffect(() => { if (open) setTyped(false); }, [open]);
  const changed = dirty ?? typed;
  async function requestClose() {
    if (!changed) { onClose(); return; }
    const discard = await confirmAction({ title: "Discard changes?", description: "What you entered in this form will be lost.", confirmLabel: "Discard changes", cancelLabel: "Keep editing", destructive: true });
    if (discard) onClose();
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) void requestClose(); }}>
    <DialogContent
      aria-labelledby={id}
      aria-describedby={description ? `${id}-description` : undefined}
      className={cn(wide && "max-w-2xl")}
      onClick={e => { if (e.target === e.currentTarget && !changed) onClose(); }}
      onCancel={e => { if (changed) { e.preventDefault(); void requestClose(); } }}
    >
      <DialogHeader className="pr-14"><DialogTitle id={id}>{title}</DialogTitle>{description && <DialogDescription id={`${id}-description`} className="text-[15px]">{description}</DialogDescription>}</DialogHeader>
      <div className="overflow-y-auto p-6" onInput={() => setTyped(true)} onChange={() => setTyped(true)}>{children}</div>
    </DialogContent>
  </Dialog>;
}

const EMPTY_ICONS: Record<"groups" | "messages" | "events" | "safety" | "search" | "requests", LucideIcon> = { groups: UsersRound, messages: MessageCircle, events: CalendarDays, safety: ShieldCheck, search: Search, requests: Inbox };
export function Empty({ title, description, children, icon = "groups", compact = false }: { title: string; description: string; children?: ReactNode; icon?: keyof typeof EMPTY_ICONS; compact?: boolean }) {
  return <EmptyState icon={EMPTY_ICONS[icon]} title={title} description={description} action={children} compact={compact} />;
}

/** A status word in the shared status style. Tones: done (green), working (amber), attention, neutral. */
export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) { return <StatusBadge tone={tone}>{children}</StatusBadge>; }
/** A quiet label (a category, a count) that is not a status. */
export function Tag({ children }: { children: ReactNode }) { return <span className="g-tag">{children}</span>; }
export function Avatar({ name }: { name: string }) { return <span className="g-avatar" aria-hidden>{name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("") || "?"}</span>; }

/**
 * The group photo is a square logo everywhere it appears — the same crop in a
 * 40px inbox row as in a 128px header. It is what the phones store and show,
 * so the dashboard shows it identically rather than letterboxing a square
 * logo into a wide banner and leaving it stranded in empty space.
 */
export function GroupAvatar({ name, url, size = 56, className }: { name: string; url: string | null; size?: number; className?: string }) {
  return <span className={cn("g-photo", className)} style={{ "--g-photo-size": `${size}px`, "--g-photo-radius": `${Math.round(size * 0.3)}px` } as CSSProperties}>{url ? <Image src={url} alt="" fill unoptimized sizes={`${size}px`} /> : <span className="g-photo-initials" aria-hidden>{groupInitials(name)}</span>}</span>;
}

type NavItem = { title: string; path: string; icon: LucideIcon; count?: number };
function NavLink({ item, active, quiet = false }: { item: NavItem; active: boolean; quiet?: boolean }) {
  return <Link href={item.path} aria-current={active ? "page" : undefined} className={cn(quiet ? "g-more-link" : "g-tab", active && "is-active")}>
    <item.icon className="size-5" aria-hidden />{item.title}
    {!!item.count && <span className="g-count" aria-label={`${item.count} waiting`}>{item.count}</span>}
  </Link>;
}

/**
 * The Groups section links. Three everyday places up front — All groups,
 * Messages, Join requests (with a count) — and the occasional ones (Reports,
 * Safety, Group settings) in a clearly labelled "More" row, always visible.
 */
export function GroupsNav({ requests = 0, reports = 0 }: { requests?: number; reports?: number }) {
  const path = usePathname() ?? base;
  const main: NavItem[] = [
    { title: "All groups", path: base, icon: LayoutGrid },
    { title: "Messages", path: `${base}/messages`, icon: MessageCircle },
    { title: "Join requests", path: `${base}/requests`, icon: Inbox, count: requests },
  ];
  const more: NavItem[] = [
    { title: "Reports", path: `${base}/insights`, icon: BarChart3 },
    { title: "Safety", path: `${base}/moderation`, icon: ShieldCheck, count: reports },
    { title: "Group settings", path: `${base}/settings`, icon: Settings2 },
  ];
  const isActive = (item: NavItem) => item.path === base ? path === base : path === item.path || path.startsWith(`${item.path}/`);
  return <div className="g-nav">
    <nav aria-label="Groups" className="g-tabs">{main.map(i => <NavLink key={i.path} item={i} active={isActive(i)} />)}</nav>
    <nav aria-label="More for groups" className="g-more"><span className="g-more-label">More:</span>{more.map(i => <NavLink key={i.path} item={i} active={isActive(i)} quiet />)}</nav>
  </div>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) { return <Link className="g-text-link" href={href}>{children}<ArrowRight className="size-5" aria-hidden /></Link>; }
export function BackLink() { return <Link href={base} className="g-back"><ChevronLeft className="size-5" aria-hidden />All groups</Link>; }
export function Stat({ title, value, hint }: { title: string; value: ReactNode; hint: string }) { return <div className="g-stat"><span>{title}</span><strong>{value}</strong><small>{hint}</small></div>; }
