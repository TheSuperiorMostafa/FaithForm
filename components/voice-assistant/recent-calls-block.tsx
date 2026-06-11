"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCallDuration,
  maskPhoneNumber,
} from "@/lib/utils/voice-assistant";
import type { PhoneCallRow } from "@/types/voice-assistant";

type RecentCallsBlockProps = {
  calls: PhoneCallRow[];
};

export function RecentCallsBlock({ calls }: RecentCallsBlockProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent calls</CardTitle>
      </CardHeader>
      <CardContent>
        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Calls will appear here once your assistant is live.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Caller</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 pr-4 tabular-nums">
                      {new Date(call.called_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2.5 pr-4">
                      {maskPhoneNumber(call.caller_number)}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">
                      {formatCallDuration(call.duration_seconds)}
                    </td>
                    <td className="py-2.5 text-muted-foreground">
                      {call.outcome ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
