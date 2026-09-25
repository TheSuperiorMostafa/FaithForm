import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { aiGenerateObject } from "@/lib/ai";
import { seriesPlanSchema } from "@/lib/ai/schemas";
import { seriesSystemPrompt } from "@/lib/ai/prompts";
import { featureAccessDenied } from "@/lib/features/guard";
import {
  createSeries,
  getChurchAISettings,
  updateSeries,
  verifySeriesAccess,
} from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";
import { sermonRouteError } from "@/lib/sermon-builder/route-error";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const body = await request.json();
    const {
      title,
      theme,
      weeks_planned = 4,
      scripture_anchor,
      description,
      seriesId,
    } = body as {
      title: string;
      theme: string;
      weeks_planned?: number;
      scripture_anchor: string;
      description?: string;
      seriesId?: string;
    };

    if (!title?.trim() || !theme?.trim()) {
      return NextResponse.json(
        { error: "Give the series a title and say what it is about." },
        { status: 400 },
      );
    }

    // Checked before the model call, not left to the update: a series id from
    // another church should cost nothing and change nothing.
    if (seriesId && !(await verifySeriesAccess(createClient(), seriesId, auth.churchId))) {
      return NextResponse.json({ error: "We couldn't find that series. It may have been deleted." }, { status: 404 });
    }

    const settings = await getChurchAISettings(auth.churchId);

    const { object, modelUsed } = await aiGenerateObject({
      churchId: auth.churchId,
      system: seriesSystemPrompt(
        title,
        theme,
        weeks_planned,
        scripture_anchor ?? "",
        settings
          ? {
              denomination: settings.denomination,
              preaching_style: settings.preaching_style,
            }
          : undefined,
      ),
      prompt: `Create a ${weeks_planned}-week sermon series plan.`,
      schema: seriesPlanSchema,
    });

    const series = seriesId
      ? await updateSeries(seriesId, {
          title,
          theme,
          description: description ?? null,
          weeks_planned,
          plan: object,
        })
      : await createSeries({
          churchId: auth.churchId,
          title,
          theme,
          description: description ?? null,
          weeks_planned,
          plan: object,
        });

    return NextResponse.json({ series, plan: object, modelUsed });
  } catch (e) {
    return sermonRouteError(e, "We couldn't plan the series.");
  }
}
