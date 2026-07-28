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
} from "@/lib/queries/sermons";

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
        { error: "Title and theme are required" },
        { status: 400 },
      );
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
    const message = e instanceof Error ? e.message : "Series generation failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
