import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import {
  validateSimpleSermonBody,
  type SimpleSermonSaveBody,
} from "@/lib/sermon-builder/simple-sermon-save";
import { createSermon } from "@/lib/queries/sermons";
import { featureAccessDenied } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";

/** A series id from the browser is kept only if it is this church's series. */
async function ownSeriesId(churchId: string, seriesId: unknown): Promise<string | null> {
  if (typeof seriesId !== "string" || !/^[0-9a-f-]{36}$/i.test(seriesId)) return null;
  const { data } = await createAdminClient()
    .from("sermon_series")
    .select("id")
    .eq("id", seriesId)
    .eq("church_id", churchId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
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

    const seriesId = await ownSeriesId(auth.churchId, body.series_id);

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
      series_id: seriesId,
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
