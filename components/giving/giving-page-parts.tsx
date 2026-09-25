import Link from "next/link";
import { ArrowLeft, HandHeart } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Words and small pieces every Giving page shares with its loading skeleton,
 * so the skeleton's static text is the same text the page renders.
 */
export const GIVING_COPY = {
  overview: {
    title: "Giving",
    description: "See what came in, who gave, and send year-end statements.",
  },
  setup: {
    title: "Giving",
    description: "Start accepting gifts online. It takes about ten minutes.",
  },
  gifts: {
    title: "All gifts",
    description: "Every gift, with search, dates and a spreadsheet download.",
  },
  donors: {
    title: "Donors",
    description: "Everyone who has given, with what they gave this year.",
  },
  donor: {
    title: "Donor",
    description: "Their gifts, recurring gifts and year-end statements.",
  },
  recurring: {
    title: "Recurring gifts",
    description: "Gifts that repeat on their own. Pause, restart or cancel them here.",
  },
  deposits: {
    title: "Deposits",
    description: "Money on its way from gifts to your church's bank account.",
  },
  statements: {
    title: "Year-end statements",
    description: "Send each donor a record of what they gave in a year.",
  },
  settings: {
    title: "Giving settings",
    description: "Funds, statement details, your giving page address and the app.",
  },
} as const;

/** Back to the Giving overview: a real 44px target, not a tiny text link. */
export function GivingBackLink({
  href = "/dashboard/giving",
  label = "Giving",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[10px] pr-3 text-[15px] font-semibold text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-accent"
    >
      <ArrowLeft className="size-5" aria-hidden />
      {label}
    </Link>
  );
}

/** The top of every Giving sub-page: a way back, then the page's own header. */
export function GivingSubpageHeader({
  page,
  title,
  description,
  action,
  secondary,
  back,
}: {
  page: Exclude<keyof typeof GIVING_COPY, "overview" | "setup">;
  back?: { href: string; label: string };
  /** Overrides the page's usual title (e.g. a donor's name). */
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <GivingBackLink href={back?.href} label={back?.label} />
      <PageHeader
        title={title ?? GIVING_COPY[page].title}
        description={description ?? GIVING_COPY[page].description}
        action={action}
        secondary={secondary}
      />
    </div>
  );
}

/** A Giving sub-page opened before the church can take gifts. */
export function GivingNotReady({ isAdmin }: { isAdmin: boolean }) {
  return (
    <EmptyState
      icon={HandHeart}
      title="Giving isn't set up yet"
      description={
        isAdmin
          ? "Connect your church's bank on the Giving page first. Then gifts, donors and deposits show up here."
          : "A church admin needs to finish setting up giving. Then gifts, donors and deposits show up here."
      }
      action={
        isAdmin ? (
          <Link href="/dashboard/giving" className={buttonVariants({ size: "lg" })}>
            Start accepting gifts
          </Link>
        ) : null
      }
    />
  );
}

export function formatGiftDate(iso: string, withYear = true): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}
