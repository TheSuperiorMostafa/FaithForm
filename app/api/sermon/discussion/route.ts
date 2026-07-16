import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { aiGenerateObject } from "@/lib/ai";
import { discussionQuestionsSchema } from "@/lib/ai/schemas";
import { discussionSystemPrompt } from "@/lib/ai/prompts";
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

function sermonSummary(sermon: {
  title: string;
  topic: string;
  outline: unknown;
  content: unknown;
}) {
  const parts = [sermon.title, sermon.topic];
  if (sermon.content) {
    parts.push(JSON.stringify(sermon.content).slice(0, 3000));
  } else if (sermon.outline) {
    parts.push(JSON.stringify(sermon.outline).slice(0, 2000));
  }
  return parts.join("\n\n");
}

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const { sermonId } = (await request.json()) as { sermonId: string };

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

    const { object, modelUsed } = await aiGenerateObject({
      churchId: auth.churchId,
      system: discussionSystemPrompt(ctx, sermonSummary(sermon)),
      prompt: "Generate small-group discussion questions.",
      schema: discussionQuestionsSchema,
    });

    await saveAsset({
      sermonId,
      kind: "discussion_questions",
      payload: { questions: object.questions, modelUsed },
    });

    return NextResponse.json({ questions: object.questions, modelUsed });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Discussion generation failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
