import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { aiGenerateObject } from "@/lib/ai";
import { socialSnippetsSchema } from "@/lib/ai/schemas";
import { socialSystemPrompt } from "@/lib/ai/prompts";
import { getChurchProfile } from "@/lib/queries/church-profile";
import {
  getChurchAISettings,
  saveAsset,
  sermonToContext,
  verifySermonAccess,
} from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const { sermonId, channels = ["instagram", "facebook", "twitter", "email"] } =
      (await request.json()) as { sermonId: string; channels?: string[] };

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, sermonId, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    const [settings, profile] = await Promise.all([
      getChurchAISettings(auth.churchId),
      getChurchProfile(auth.churchId, supabase),
    ]);
    const ctx = sermonToContext(sermon, settings, profile);
    const summary = [sermon.title, sermon.topic, JSON.stringify(sermon.outline ?? {})].join(
      "\n",
    );

    const { object, modelUsed } = await aiGenerateObject({
      churchId: auth.churchId,
      system: socialSystemPrompt(ctx, summary, channels),
      prompt: "Write social and email snippets for the requested channels.",
      schema: socialSnippetsSchema,
    });

    await saveAsset({
      sermonId,
      kind: "social_snippet",
      payload: { ...object, modelUsed, channels },
    });

    return NextResponse.json({ snippets: object, modelUsed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Social generation failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
