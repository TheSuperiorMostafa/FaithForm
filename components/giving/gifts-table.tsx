import Link from "next/link";
import { Receipt } from "lucide-react";

import { formatGiftDate } from "@/components/giving/giving-page-parts";
import { RefundButton } from "@/components/giving/refund-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { donorDisplayName, giftStatus, giftTypeLabel, isRefundable } from "@/lib/giving/labels";
import { formatCents } from "@/lib/utils/currency";
import type { GivingDonationRow } from "@/types/giving";

/**
 * The treasurer's table. It stays a table because people compare, sort and
 * export it; everything in it is in plain words.
 */
export function GiftsTable({
  donations,
  isAdmin,
  filtered = false,
}: {
  donations: GivingDonationRow[];
  isAdmin: boolean;
  filtered?: boolean;
}) {
  if (donations.length === 0) {
    return (
      <EmptyState
        compact
        icon={Receipt}
        title={filtered ? "No gifts match" : "No gifts yet"}
        description={
          filtered
            ? "Try other dates, or clear the filters to see every gift."
            : "When someone gives, their gift shows up here."
        }
        className="m-4 border-0"
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-[15px]">
        <caption className="sr-only">Gifts, newest first</caption>
        <thead className="border-b border-border text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-5 py-4 font-semibold">Date</th>
            <th scope="col" className="px-5 py-4 font-semibold">Donor</th>
            <th scope="col" className="px-5 py-4 text-right font-semibold">Amount</th>
            <th scope="col" className="px-5 py-4 text-right font-semibold">After fees</th>
            <th scope="col" className="px-5 py-4 font-semibold">Fund</th>
            <th scope="col" className="px-5 py-4 font-semibold">Type</th>
            <th scope="col" className="px-5 py-4 font-semibold">Status</th>
            {isAdmin && (
              <th scope="col" className="px-5 py-4 font-semibold">
                <span className="sr-only">Refund</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {donations.map((d) => {
            const status = giftStatus(d.status);
            const name = donorDisplayName(d);
            return (
              <tr key={d.id} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap px-5 py-4 text-foreground">
                  {formatGiftDate(d.createdAt)}
                </td>
                <td className="px-5 py-4">
                  {d.donorId ? (
                    <Link
                      href={`/dashboard/giving/donors/${d.donorId}`}
                      className="font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline dark:hover:text-accent"
                    >
                      {name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-foreground">{name}</span>
                  )}
                  {d.donorEmail && d.donorName && (
                    <div className="text-sm text-muted-foreground">{d.donorEmail}</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-right font-semibold text-foreground">
                  {formatCents(d.amountCents, d.currency)}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-right text-muted-foreground">
                  {d.netAmountCents != null ? formatCents(d.netAmountCents, d.currency) : "—"}
                </td>
                <td className="px-5 py-4 text-muted-foreground">
                  {d.fundName ?? d.fundDesignation ?? "—"}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">
                  {giftTypeLabel(d.giftType)}
                </td>
                <td className="px-5 py-4">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </td>
                {isAdmin && (
                  <td className="px-5 py-4 text-right">
                    {isRefundable(d) ? <RefundButton donation={d} /> : null}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
