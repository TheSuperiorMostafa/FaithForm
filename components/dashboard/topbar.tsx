"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { cn } from "@/lib/utils";
import { currentNavLabel } from "./nav-items";

type TopbarProps = {
  churchName?: string | null;
  avatarUrl?: string | null;
  userEmail?: string;
};

/**
 * Says where you are (the section name, matching the sidebar) and keeps Help
 * in the same place on every page and every screen size (WCAG 3.2.6).
 */
export function Topbar({ churchName, userEmail }: TopbarProps) {
  const pathname = usePathname();
  const section = currentNavLabel(pathname);
  const showAdminLink = isBootstrapSuperAdminEmail(userEmail);
  const onHelp = pathname.startsWith("/dashboard/support");

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/90 px-5 backdrop-blur-xl md:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Logo size={36} className="md:hidden" />
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-sm font-semibold text-muted-foreground">
            {churchName ?? "FaithForm"}
          </p>
          <p className="truncate font-heading text-lg font-bold leading-tight text-foreground">
            {section ?? "Dashboard"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {showAdminLink && (
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-primary/35 bg-background px-3 text-sm font-semibold text-primary transition-colors hover:border-accent hover:bg-accent/10"
          >
            <ShieldCheck className="size-4" strokeWidth={1.75} aria-hidden />
            Admin
          </Link>
        )}
        <Link
          href="/dashboard/support"
          aria-current={onHelp ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            onHelp
              ? "border-accent bg-accent/15 text-primary dark:text-accent"
              : "border-border bg-card text-foreground hover:border-accent hover:bg-accent/10",
          )}
        >
          <CircleHelp className="size-5" strokeWidth={1.75} aria-hidden />
          Help
        </Link>
      </div>
    </header>
  );
}
