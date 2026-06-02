import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";

type TopbarProps = {
  churchName?: string | null;
  userEmail?: string;
};

export function Topbar({ churchName, userEmail }: TopbarProps) {
  const initials = userEmail
    ? userEmail.charAt(0).toUpperCase()
    : (churchName ?? "F").charAt(0).toUpperCase();
  const showAdminLink = isBootstrapSuperAdminEmail(userEmail);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/90 px-5 shadow-sm backdrop-blur-xl md:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Logo size={36} className="md:hidden" />
        <div className="flex min-w-0 flex-col">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-accent">
            Dashboard
          </p>
          <h1 className="truncate font-heading text-lg font-bold text-foreground md:text-xl">
            {churchName ?? "FaithForm"}
          </h1>
        </div>
      </div>

      {/* Mobile: show avatar + signout. Desktop: hidden (sidebar handles this). */}
      <div className="flex items-center gap-2 md:hidden">
        {showAdminLink && (
          <Link
            href="/admin"
            aria-label="Admin dashboard"
            className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-primary/35 bg-background px-3 text-sm font-semibold text-primary transition-colors hover:border-accent hover:bg-accent/10"
          >
            <ShieldCheck className="size-4" strokeWidth={1.75} />
            Admin
          </Link>
        )}
        <div
          className="flex size-10 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground shadow-sm"
          aria-hidden
        >
          {initials}
        </div>
        <form action="/auth/signout" method="post">
          <Button
            type="submit"
            variant="ghost"
            size="icon-lg"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Sign out"
          >
            <LogOut className="size-5" strokeWidth={1.75} />
          </Button>
        </form>
      </div>
    </header>
  );
}
