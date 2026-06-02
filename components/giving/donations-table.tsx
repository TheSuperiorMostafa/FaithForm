import Link from "next/link";
import { formatCents } from "@/lib/utils/currency";
import type { GivingDonationRow } from "@/types/giving";

function displayDonor(d: GivingDonationRow): string {
  if (d.donorName) return d.donorName;
  if (d.donorEmail) return d.donorEmail;
  return "Guest";
}

export function DonationsTable({
  donations,
  showFund = false,
  showActions = false,
}: {
  donations: GivingDonationRow[];
  showFund?: boolean;
  showActions?: boolean;
}) {
  if (donations.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No gifts recorded yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Type</th>
            {showFund && <th className="px-4 py-3 font-medium">Fund</th>}
            <th className="px-4 py-3 font-medium">Donor</th>
            <th className="px-4 py-3 font-medium">Status</th>
            {showActions && <th className="px-4 py-3 font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {donations.map((d) => (
            <tr key={d.id} className="border-b border-border/60">
              <td className="px-4 py-3">
                {new Date(d.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </td>
              <td className="px-4 py-3 font-medium">
                {formatCents(d.amountCents, d.currency)}
              </td>
              <td className="px-4 py-3 capitalize">{d.giftType.replace("_", " ")}</td>
              {showFund && (
                <td className="px-4 py-3 text-muted-foreground">
                  {d.fundName ?? d.fundDesignation ?? "—"}
                </td>
              )}
              <td className="px-4 py-3 text-muted-foreground">{displayDonor(d)}</td>
              <td className="px-4 py-3 capitalize">{d.status}</td>
              {showActions && (
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/giving/gifts?highlight=${d.id}`}
                    className="text-accent hover:underline"
                  >
                    View
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
