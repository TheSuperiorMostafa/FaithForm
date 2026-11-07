import { NextResponse } from "next/server";
import { runOperationsMonitor } from "@/lib/operations/alerts";
import { compareSecret } from "@/lib/security/compare-secret";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  return compareSecret(provided, process.env.CRON_SECRET);
}

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function monitor(test = false) {
  try {
    const result = await runOperationsMonitor({ test });
    if (result.alert === "disabled") {
      return response({ ok: !test, alert: "disabled" }, test ? 503 : 200);
    }
    return response({ ok: result.alert !== "deferred", ...result }, result.alert === "deferred" ? 503 : 200);
  } catch {
    return response({ ok: false, error: "Operations monitoring unavailable" }, 503);
  }
}

/** Scheduled checks send once per incident; unchanged failures stay quiet. */
export async function GET(request: Request) {
  if (!authorized(request)) return response({ error: "Unauthorized" }, 401);
  return monitor();
}

/** Explicit authenticated test delivery, only to the existing recipients. */
export async function POST(request: Request) {
  if (!authorized(request)) return response({ error: "Unauthorized" }, 401);
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || body.test !== true || Object.keys(body).length !== 1) {
      return response({ error: "Invalid request" }, 400);
    }
  } catch {
    return response({ error: "Invalid request" }, 400);
  }
  return monitor(true);
}
