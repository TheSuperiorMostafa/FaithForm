import { Info } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { StatusTone } from "@/components/ui/status-badge";
import type { FundAccountStatus, FundsBankAccount } from "@/lib/queries/fund-accounts";

/**
 * Words and small pieces the Funds & banks page shares with its loading
 * skeleton, so the skeleton's static text is the same text the page renders.
 * No hooks here: the skeleton is a server component.
 */
export const FUNDS_BANKS_COPY = {
  fundsTitle: "Funds",
  fundsDescription: "Where each fund's gifts go, and what reached the bank lately.",
  accountsTitle: "Bank accounts",
  accountsDescription: "Choose one to see its deposits, rename it or finish setting it up.",
} as const;

/** The two things a treasurer must know before splitting funds across banks. */
export function FundsBanksNotes() {
  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center gap-3">
        <Info className="size-5 shrink-0 text-primary dark:text-accent" aria-hidden />
        <h2 className="font-heading text-lg font-bold text-foreground">Good to know</h2>
      </div>
      <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-muted-foreground">
        <li>
          Each fund&apos;s bank details are entered only in Stripe, our secure payment partner. FaithForm never asks for
          or stores a full account number.
        </li>
        <li>
          A card a donor saved while giving to one bank isn&apos;t available for a fund that uses a different bank. They
          enter it again the first time.
        </li>
        <li>A fund on a new bank stays off your giving page until Stripe finishes setting that bank up.</li>
      </ul>
    </Card>
  );
}

export function accountStatusLabel(status: FundAccountStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case "active":
      return { label: "Active", tone: "done" };
    case "needs_info":
      return { label: "Needs info", tone: "attention" };
    case "pending":
      return { label: "Pending", tone: "working" };
    case "disconnected":
      return { label: "Disconnected", tone: "attention" };
  }
}

/** "Community Bank •••1234", or a plain note before Stripe has told us. */
export function bankLine(account: Pick<FundsBankAccount, "bankName" | "bankLast4">): string {
  if (!account.bankName && !account.bankLast4) return "Awaiting first payout";
  const name = account.bankName ?? "Bank";
  return account.bankLast4 ? `${name} •••${account.bankLast4}` : name;
}

const WEEKDAYS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Stripe's payout schedule in plain words: "Daily, 2-day delay", "Weekly on Monday". */
export function payoutScheduleLine(schedule: FundsBankAccount["payoutSchedule"]): string {
  if (!schedule?.interval) return "Shown once Stripe finishes setup";
  const delay =
    typeof schedule.delayDays === "number" && schedule.delayDays > 0
      ? `${schedule.delayDays}-day delay`
      : schedule.delayDays === "minimum"
        ? "shortest delay"
        : null;
  switch (schedule.interval) {
    case "daily":
      return delay ? `Daily, ${delay}` : "Daily";
    case "weekly": {
      const day = schedule.weeklyAnchor ? WEEKDAYS[schedule.weeklyAnchor.toLowerCase()] : null;
      return day ? `Weekly on ${day}` : "Weekly";
    }
    case "monthly":
      return schedule.monthlyAnchor ? `Monthly on the ${ordinal(schedule.monthlyAnchor)}` : "Monthly";
    case "manual":
      return "Only when someone sends it from Stripe";
    default:
      return "Set in Stripe";
  }
}

/** Stripe arrival dates are midnight UTC on the day the money arrives. */
export function formatPayoutDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
