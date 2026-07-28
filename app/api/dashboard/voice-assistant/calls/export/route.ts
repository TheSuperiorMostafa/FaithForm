import { NextResponse } from "next/server";
import { logAdminAction } from "@/lib/activity/admin-log";
import {
  forbiddenResponse,
  requireChurchAdmin,
} from "@/lib/auth/require-church-admin";
import {
  formatCallDuration,
  maskPhoneNumber,
} from "@/lib/utils/voice-assistant";
import { getRecentPhoneCalls } from "@/lib/queries/voice-assistant";
import { featureAccessDenied } from "@/lib/features/guard";

function escapeCsv(value: string | null | undefined): string {
  const text = value ?? "";
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET() {
  let auth;
  try {
    auth = await requireChurchAdmin();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    if (message === "Forbidden") return forbiddenResponse();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await featureAccessDenied("voice_assistant");
  if (denied) return denied;

  const calls = await getRecentPhoneCalls(auth.churchId, 500);

  const header = [
    "Date",
    "Caller",
    "Duration",
    "Outcome",
    "Sentiment",
    "Score",
    "Successful",
    "Recording URL",
    "Transcript",
  ].join(",");

  const rows = calls.map((call) =>
    [
      new Date(call.called_at).toISOString(),
      escapeCsv(maskPhoneNumber(call.caller_number)),
      escapeCsv(formatCallDuration(call.duration_seconds)),
      escapeCsv(call.outcome),
      escapeCsv(call.sentiment),
      escapeCsv(
        call.ai_score != null ? String(Math.round(Number(call.ai_score))) : "",
      ),
      escapeCsv(
        call.call_successful == null
          ? ""
          : call.call_successful
            ? "Yes"
            : "No",
      ),
      escapeCsv(call.recording_url),
      escapeCsv(call.transcript),
    ].join(","),
  );

  const csv = [header, ...rows].join("\n");
  const filename = `faithform-calls-${new Date().toISOString().slice(0, 10)}.csv`;

  await logAdminAction({
    churchId: auth.churchId,
    taskName: `Exported ${calls.length} voice calls to CSV`,
    triggerSource: "admin:export:voice-calls",
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
