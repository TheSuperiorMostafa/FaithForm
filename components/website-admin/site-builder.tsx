"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { createWebsite } from "@/app/dashboard/website/actions";
import { Button } from "@/components/ui/button";
import type { SiteThemeOption } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

/**
 * The build-it-yourself entry point.
 *
 * A church shouldn't have to wait on us to get a website. This reads their
 * Church Profile, picks the sections that make sense for what they've filled
 * in, drafts the copy, and hands back an editable draft — nothing goes public
 * until they press publish.
 */
export function SiteBuilder({
  themes,
  canBuild,
  readiness,
}: {
  themes: SiteThemeOption[];
  canBuild: boolean;
  /** What the profile can and can't fill, so the church knows before building. */
  readiness: { label: string; ready: boolean; hint: string }[];
}) {
  const [themeKey, setThemeKey] = useState(themes[0]?.key ?? "grace");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function build() {
    startTransition(async () => {
      const result = await createWebsite(themeKey);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.aiCopyUsed
          ? "Your website is built. Review the draft, then publish when you're happy."
          : "Your website is built with starter text — AI copy wasn't available, so edit the wording in Pages.",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Globe className="size-6" strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 className="font-heading text-xl font-bold">Build your website</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              We&apos;ll build a first draft from your Church Profile — your
              service times, staff, address and beliefs — and write the wording
              to go around them. It saves as a draft, so nothing is public until
              you say so. You can change every word afterwards.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <h3 className="font-heading text-lg font-bold">Pick a look</h3>
        <p className="text-sm text-muted-foreground">
          You can switch designs later, and set your own colours, without losing
          any of your words.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {themes.map((theme) => (
            <button
              key={theme.key}
              type="button"
              disabled={!canBuild || pending}
              onClick={() => setThemeKey(theme.key)}
              aria-pressed={themeKey === theme.key}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                themeKey === theme.key
                  ? "border-accent bg-accent/5"
                  : "border-border hover:border-accent/50",
              )}
            >
              <div className="font-heading text-base font-bold">{theme.name}</div>
              {theme.description ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {theme.description}
                </p>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <h3 className="font-heading text-lg font-bold">What we&apos;ll use</h3>
        <p className="text-sm text-muted-foreground">
          Anything missing just means a section starts out hidden — you can fill
          it in and switch it on whenever.
        </p>

        <ul className="mt-4 flex flex-col gap-2">
          {readiness.map((item) => (
            <li key={item.label} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  item.ready ? "bg-accent" : "bg-muted-foreground/40",
                )}
              />
              <span>
                <span className="font-medium">{item.label}</span>
                <span className="text-muted-foreground"> — {item.hint}</span>
              </span>
            </li>
          ))}
        </ul>

        <Link
          href="/dashboard/support"
          className="mt-4 inline-block text-sm font-semibold text-accent underline underline-offset-4"
        >
          Missing something? Ask support to fill it in
        </Link>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" onClick={build} disabled={!canBuild || pending}>
          <Sparkles className="mr-2 size-4" />
          {pending ? "Building your website…" : "Build my website"}
        </Button>
        {pending ? (
          <span className="text-sm text-muted-foreground">
            This takes about half a minute.
          </span>
        ) : null}
      </div>

      {!canBuild ? (
        <p className="text-xs text-muted-foreground">
          Only church admins can build the website.
        </p>
      ) : null}
    </div>
  );
}
