"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import { ArrowUpRight, CalendarDays, Check, ChevronRight, LayoutGrid, Loader2, MessageCircle, Search, Settings2, ShieldCheck, UsersRound, ChartNoAxesCombined, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StaffActionResult } from "@/lib/groups/staff/context";
import { cn } from "@/lib/utils";

export const base = "/dashboard/groups";
export const label = (value: string) => value.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
export function date(value: string | null, timezone?: string) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(value)) : "Not yet"; }
export function dateTime(value: string, timezone?: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timezone ? { timeZone: timezone, timeZoneName: "short" } : {}) }).format(new Date(value)); }
export function useGroupAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  function run<T>(operation: () => Promise<StaffActionResult<T>>, message?: string, done?: (data: T) => void) {
    setError(null);
    start(async () => {
      try {
        const result = await operation();
        if (!result.ok) { setError(result.error); return; }
        if (message) toast.success(message);
        done?.(result.data);
        router.refresh();
      } catch { setError("We couldn’t connect. Your changes haven’t been confirmed. Please try again."); }
    });
  }
  return { pending, error, run };
}
export function Notice({ children }: { children: ReactNode }) { return <div role="alert" className="g-notice">{children}</div>; }
export function Submit({ pending, children = "Save changes" }: { pending: boolean; children?: ReactNode }) { return <Button type="submit" disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{pending ? "Saving…" : children}</Button>; }
export function Field({ label: title, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="g-field"><span>{title}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Toggle({ name, title, description, checked = false, disabled = false }: { name: string; title: string; description?: string; checked?: boolean; disabled?: boolean }) { return <label className="g-toggle"><span><strong>{title}</strong>{description && <small>{description}</small>}</span><input type="checkbox" name={name} defaultChecked={checked} disabled={disabled} className="size-5 accent-[#002D5F]" /></label>; }
export function Modal({ title, description, open, onClose, children, wide = false }: { title: string; description?: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) { const id = useId(); return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent aria-labelledby={id} aria-describedby={description ? `${id}-description` : undefined} className={cn(wide && "max-w-2xl")}><DialogHeader><DialogTitle id={id}>{title}</DialogTitle>{description && <DialogDescription id={`${id}-description`}>{description}</DialogDescription>}</DialogHeader><div className="overflow-y-auto p-6">{children}</div></DialogContent></Dialog>; }
export function Empty({ title, description, children, icon = "groups" }: { title: string; description: string; children?: ReactNode; icon?: "groups" | "messages" | "events" | "safety" | "search" }) { const Icon = ({ groups: UsersRound, messages: MessageCircle, events: CalendarDays, safety: ShieldCheck, search: Search })[icon]; return <div className="g-empty"><div className="g-empty-icon"><Icon className="size-7" strokeWidth={1.5} /></div><h3>{title}</h3><p>{description}</p>{children}</div>; }
export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" }) { return <span className={cn("g-pill", `g-pill-${tone}`)}>{children}</span>; }
export function Avatar({ name }: { name: string }) { return <span className="g-avatar" aria-hidden>{name.split(" ").slice(0, 2).map(p => p[0]).join("")}</span>; }
export function GroupCover({ name, url, index = 0, large = false }: { name: string; url: string | null; index?: number; large?: boolean }) { return <div className={cn("g-cover", `g-cover-${index % 4}`, large && "g-cover-large")}>{url ? <Image src={url} alt="" fill unoptimized sizes="(max-width: 768px) 100vw, 33vw" /> : <><div className="g-cover-orbit" /><UsersRound size={large ? 60 : 38} strokeWidth={1.1} /><span className="g-cover-word">{name}</span></>}</div>; }
export function PageHeading({ eyebrow = "LIFE TOGETHER", title, description, children }: { eyebrow?: string; title: string; description: string; children?: ReactNode }) { return <header className="g-heading"><div><p className="g-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="g-description">{description}</p></div><div className="flex flex-wrap items-center gap-3">{children}</div></header>; }
export function GroupsNav({ requests = 0, reports = 0 }: { requests?: number; reports?: number }) {
  const path = usePathname();
  const items = [{ title: "All groups", path: base, icon: LayoutGrid }, { title: "Messages", path: `${base}/messages`, icon: MessageCircle }, { title: "Requests", path: `${base}/requests`, icon: Inbox, count: requests }, { title: "Insights", path: `${base}/insights`, icon: ChartNoAxesCombined }, { title: "Moderation", path: `${base}/moderation`, icon: ShieldCheck, count: reports }, { title: "Settings", path: `${base}/settings`, icon: Settings2 }];
  const known = items.slice(1).some(i => path.startsWith(i.path));
  return <nav aria-label="Groups workspace" className="g-nav">{items.map(i => { const active = i.path === base ? !known : path.startsWith(i.path); return <Link key={i.path} href={i.path} aria-current={active ? "page" : undefined} className={cn(active && "is-active")}><i.icon className="size-4" />{i.title}{!!i.count && <span>{i.count}</span>}</Link>; })}</nav>;
}
export function TextLink({ href, children }: { href: string; children: ReactNode }) { return <Link className="g-text-link" href={href}>{children}<ArrowUpRight className="size-4" /></Link>; }
export function BackLink() { return <Link href={base} className="g-back"><ChevronRight className="size-4 rotate-180" />All groups</Link>; }
export function Stat({ title, value, hint }: { title: string; value: ReactNode; hint: string }) { return <div className="g-stat"><span>{title}</span><strong>{value}</strong><small>{hint}</small></div>; }
