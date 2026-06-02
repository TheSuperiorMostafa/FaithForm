import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { aiGenerateLargeObject } from "@/lib/ai";
import { sermonContentSchema } from "@/lib/ai/schemas";
import { draftSystemPrompt } from "@/lib/ai/prompts";
import {
  getChurchAISettings,
  sermonToContext,
  updateSermon,
  verifySermonAccess,
} from "@/lib/queries/sermons";
import { fetchPassages } from "@/lib/scripture/esv";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const { sermonId } = (await request.json()) as { sermonId: string };

    if (!sermonId) {
      return NextResponse.json({ error: "sermonId required" }, { status: 400 });
    }

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, sermonId, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    if (!sermon.outline) {
      return NextResponse.json(
        { error: "Generate an outline first" },
        { status: 400 },
      );
    }

    const settings = await getChurchAISettings(auth.churchId);
    const ctx = sermonToContext(sermon, settings);

    const passages = await fetchPassages(sermon.scripture_refs);
    const scriptureText = passages.map((p) => `${p.ref}\n${p.text}`).join("\n\n");

    const { object, modelUsed } = await aiGenerateLargeObject({
      churchId: auth.churchId,
      system: draftSystemPrompt(
        ctx,
        JSON.stringify(sermon.outline, null, 2),
        scriptureText,
      ),
      prompt:
        "Write the full sermon manuscript as one JSON object matching the schema exactly.",
      schema: sermonContentSchema,
      maxOutputTokens: 16384,
    });

    const updated = await updateSermon(sermonId, {
      content: object,
      model_used: modelUsed,
      title: sermon.title || (sermon.outline as { title?: string })?.title,
    });

    return NextResponse.json({ sermon: updated, content: object, modelUsed });
  } catch (e) {
    console.error("[sermon/draft] failed", e);
    const raw = e instanceof Error ? e.message : "Draft generation failed";
    const message = raw.includes("could not parse")
      ? "The AI draft was incomplete or malformed. Please try Generate again — if it keeps failing, lower the target duration in sermon settings."
      : raw;
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
