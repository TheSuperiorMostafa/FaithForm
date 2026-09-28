import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import {
  validateSimpleSermonBody,
  type SimpleSermonSaveBody,
} from "@/lib/sermon-builder/simple-sermon-save";
import { createSermon } from "@/lib/queries/sermons";
import { featureAccessDenied } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SeriesPlan } from "@/types/sermon";

/** A planned week must belong to this church's series before it is saved. */
async function ownSeriesWeek(
  churchId: string,
  seriesId: unknown,
  seriesWeek: unknown,
): Promise<{ seriesId: string | null; seriesWeek: number | null } | { error: string; status: number }> {
  if (seriesId == null || seriesId === "") {
    return seriesWeek == null
      ? { seriesId: null, seriesWeek: null }
      : { error: "Choose a sermon series before choosing its week.", status: 400 };
  }
  if (typeof seriesId !== "string" || !/^[0-9a-f-]{36}$/i.test(seriesId)) {
    return { error: "This sermon series isn't available. Go back and choose it again.", status: 400 };
  }
  const { data, error } = await createAdminClient()
    .from("sermon_series")
    .select("id, plan")
    .eq("id", seriesId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (error) return { error: "We couldn't check this sermon series. Please try again.", status: 503 };
  if (!data) return { error: "This sermon series isn't available. Go back and choose it again.", status: 400 };
  if (seriesWeek == null) return { seriesId: data.id, seriesWeek: null };
  const weeks = ((data.plan as SeriesPlan | null)?.weeks ?? []);
  if (typeof seriesWeek !== "number" || !Number.isInteger(seriesWeek) ||
      !weeks.some((week) => week.week === seriesWeek)) {
    return { error: "That week isn't in this sermon series. Go back and choose a week again.", status: 400 };
  }
  return { seriesId: data.id, seriesWeek };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const body = (await request.json()) as SimpleSermonSaveBody;

    const validated = await validateSimpleSermonBody(body);
    if ("error" in validated) {
      return NextResponse.json(
        { error: validated.error },
        { status: validated.status },
      );
    }

    const series = await ownSeriesWeek(auth.churchId, body.series_id, body.series_week);
    if ("error" in series) {
      return NextResponse.json({ error: series.error }, { status: series.status });
    }

    const sermon = await createSermon({
      churchId: auth.churchId,
      userId: auth.userId,
      title: validated.title,
      topic: "",
      scripture_refs: validated.scripture_refs,
      audience: "General congregation",
      duration_min: 0,
      kind: "simple",
      theme_id: validated.theme_id,
      translation: validated.translation,
      sermon_date: validated.sermon_date,
      series_id: series.seriesId,
      series_week: series.seriesWeek,
    });

    return NextResponse.json({ sermon: { id: sermon.id } });
  } catch (e) {
    const unauthorized = e instanceof Error && e.message === "Unauthorized";
    if (!unauthorized) console.error("[sermon/simple] create failed", e);
    return NextResponse.json(
      {
        error: unauthorized
          ? "Your sign-in has expired. Sign in again to save this sermon."
          : "We couldn't save this sermon. Your work is still on the page. Please try again.",
      },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
