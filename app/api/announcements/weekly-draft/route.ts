import { NextResponse } from "next/server";
import { runWeeklyAnnouncementDraftsForAllChurches } from "@/lib/announcements/weekly-email";
import { compareSecret } from "@/lib/security/compare-secret";

export async function GET(request: Request) {
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret");
  const expected = process.env.CRON_SECRET;

  if (!compareSecret(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force =
    new URL(request.url).searchParams.get("force") === "1" ||
    new URL(request.url).searchParams.get("force") === "true";

  const result = await runWeeklyAnnouncementDraftsForAllChurches({ force });

  return NextResponse.json({ ok: true, ...result });
}
