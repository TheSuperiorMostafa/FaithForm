import { formatCents } from "@/lib/utils/currency";
import type { FundGivingBreakdown } from "@/types/giving";

export function FundBreakdown({
  title,
  funds,
}: {
  title: string;
  funds: FundGivingBreakdown[];
}) {
  if (funds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No gifts in this period yet.</p>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h3>
      <ul className="space-y-2">
        {funds.map((f) => (
          <li
            key={f.fundId}
            className="flex items-center justify-between text-sm"
          >
            <span>{f.fundName}</span>
            <span className="text-muted-foreground">
              {f.giftCount} gifts · {formatCents(f.totalCents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
