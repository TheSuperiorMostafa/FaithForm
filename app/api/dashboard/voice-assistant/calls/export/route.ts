import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import {
  formatCallDuration,
  maskPhoneNumber,
} from "@/lib/utils/voice-assistant";
import { getRecentPhoneCalls } from "@/lib/queries/voice-assistant";

function escapeCsv(value: string | null | undefined): string {
  const text = value ?? "";
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET() {
  const auth = await getChurchAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const calls = await getRecentPhoneCalls(auth.churchId, 500);

  const header = [
    "Date",
    "Caller",
    "Duration",
    "Outcome",
    "Sentiment",
    "Transcript",
  ].join(",");

  const rows = calls.map((call) =>
    [
      new Date(call.called_at).toISOString(),
      escapeCsv(maskPhoneNumber(call.caller_number)),
      escapeCsv(formatCallDuration(call.duration_seconds)),
      escapeCsv(call.outcome),
      escapeCsv(call.sentiment),
      escapeCsv(call.transcript),
    ].join(","),
  );

  const csv = [header, ...rows].join("\n");
  const filename = `faithform-calls-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
