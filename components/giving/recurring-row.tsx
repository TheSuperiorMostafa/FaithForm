import Link from "next/link";

import { RecurringActions } from "@/components/giving/recurring-actions";
import { formatGiftDate } from "@/components/giving/giving-page-parts";
import { InitialsAvatar } from "@/components/ui/list-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { donorDisplayName, intervalLabel, recurringStatus } from "@/lib/giving/labels";
import { formatCents } from "@/lib/utils/currency";
import type { GivingSubscriptionRow } from "@/types/giving";

/**
 * One recurring gift as a big row: who, how much and how often, its state in
 * plain words, and (for admins) Pause/Resume and Cancel beside it. Stacks on
 * a phone so the buttons never squeeze the name.
 */
export function RecurringRow({
  subscription: s,
  canManage,
  showDonor = true,
}: {
  subscription: GivingSubscriptionRow;
  canManage: boolean;
  showDonor?: boolean;
}) {
  const name = donorDisplayName(s);
  const status = recurringStatus(s.status, s.pausedAt);
  const amount = formatCents(s.amountCents, s.currency);
  const details = `${intervalLabel(s.interval)} · ${s.fundName ?? s.fundDesignation ?? "General"} · since ${formatGiftDate(s.createdAt)}`;

  return (
    <li className="flex flex-col gap-3 rounded-2xl px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {showDonor && <InitialsAvatar name={name} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">
            {showDonor ? (
              s.donorId ? (
                <Link
                  href={`/dashboard/giving/donors/${s.donorId}`}
                  className="underline-offset-4 hover:text-primary hover:underline dark:hover:text-accent"
                >
                  {name}
                </Link>
              ) : (
                name
              )
            ) : (
              `${amount} ${intervalLabel(s.interval).toLowerCase()}`
            )}
          </p>
          <p className="mt-0.5 truncate text-[15px] text-muted-foreground">
            {showDonor ? `${amount} · ${details}` : details}
          </p>
        </div>
        <StatusBadge tone={status.tone} className="shrink-0">
          {status.label}
        </StatusBadge>
      </div>
      {canManage && (
        <div className="sm:shrink-0">
          <RecurringActions subscription={s} />
        </div>
      )}
    </li>
  );
}
