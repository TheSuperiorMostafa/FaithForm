import { formatCents } from "@/lib/utils/currency";
import type { GivingDonationRow } from "@/types/giving";
import { RefundButton } from "@/components/giving/refund-button";

function displayDonor(d: GivingDonationRow): string {
  if (d.donorName) return d.donorName;
  if (d.donorEmail) return d.donorEmail;
  return "Guest";
}

export function GiftsTable({ donations }: { donations: GivingDonationRow[] }) {
  if (donations.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No gifts match your filters.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] text-sm">
        <thead className="border-b border-border text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Donor</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Fund</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Net</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {donations.map((d) => (
            <tr key={d.id} className="border-b border-border/60">
              <td className="px-4 py-3">
                {new Date(d.createdAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </td>
              <td className="px-4 py-3">
                <div className="font-medium">{displayDonor(d)}</div>
                {d.donorEmail && d.donorName && (
                  <div className="text-xs text-muted-foreground">{d.donorEmail}</div>
                )}
              </td>
              <td className="px-4 py-3 font-medium">
                {formatCents(d.amountCents, d.currency)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {d.fundName ?? "—"}
              </td>
              <td className="px-4 py-3 capitalize">{d.giftType.replace("_", " ")}</td>
              <td className="px-4 py-3 capitalize">{d.status}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {d.netAmountCents != null
                  ? formatCents(d.netAmountCents, d.currency)
                  : "—"}
              </td>
              <td className="px-4 py-3">
                <RefundButton donation={d} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
