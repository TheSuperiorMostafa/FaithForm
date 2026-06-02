import { formatCents } from "@/lib/utils/currency";
import type { GivingDonorRow } from "@/types/giving";

export function DonorsTable({ donors }: { donors: GivingDonorRow[] }) {
  if (donors.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No donors yet. Gifts with name and email will appear here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead className="border-b border-border text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">YTD given</th>
            <th className="px-4 py-3 font-medium">Gifts</th>
            <th className="px-4 py-3 font-medium">Last gift</th>
          </tr>
        </thead>
        <tbody>
          {donors.map((d) => (
            <tr key={d.id} className="border-b border-border/60">
              <td className="px-4 py-3 font-medium">{d.name ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{d.email}</td>
              <td className="px-4 py-3">{formatCents(d.ytdCents)}</td>
              <td className="px-4 py-3">{d.giftCount}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {d.lastGiftAt
                  ? new Date(d.lastGiftAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
