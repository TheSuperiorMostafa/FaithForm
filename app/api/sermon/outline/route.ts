import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { aiGenerateObject } from "@/lib/ai";
import { sermonOutlineSchema } from "@/lib/ai/schemas";
import { outlineSystemPrompt } from "@/lib/ai/prompts";
import {
  createSermon,
  getChurchAISettings,
  updateSermon,
  verifySermonAccess,
} from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const body = await request.json();
    const {
      topic,
      scripture_refs = [],
      audience = "General congregation",
      duration_min = 30,
      style_notes,
      title,
      series_id,
      sermonId,
    } = body as {
      topic: string;
      scripture_refs?: string[];
      audience?: string;
      duration_min?: number;
      style_notes?: string;
      title?: string;
      series_id?: string;
      sermonId?: string;
    };

    const cleanedRefs = scripture_refs.filter(Boolean);
    const trimmedTopic = topic?.trim() ?? "";

    if (!trimmedTopic && cleanedRefs.length === 0) {
      return NextResponse.json(
        { error: "Provide a topic or at least one scripture reference." },
        { status: 400 },
      );
    }

    const settings = await getChurchAISettings(auth.churchId);
    const effectiveTopic =
      trimmedTopic ||
      `Exposition of ${cleanedRefs.join(", ")}`;

    const ctx = {
      topic: effectiveTopic,
      scripture_refs: cleanedRefs,
      audience,
      duration_min,
      style_notes: style_notes ?? null,
      denomination: settings?.denomination ?? null,
      preaching_style: settings?.preaching_style ?? null,
    };

    let sermon;
    if (sermonId) {
      const supabase = createClient();
      const existing = await verifySermonAccess(supabase, sermonId, auth.churchId);
      if (!existing) {
        return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
      }
      sermon = await updateSermon(sermonId, {
        topic: ctx.topic,
        scripture_refs: ctx.scripture_refs,
        audience: ctx.audience,
        duration_min: ctx.duration_min,
        style_notes: ctx.style_notes,
        title: title ?? undefined,
      });
    } else {
      sermon = await createSermon({
        churchId: auth.churchId,
        userId: auth.userId,
        topic: ctx.topic,
        scripture_refs: ctx.scripture_refs,
        audience: ctx.audience,
        duration_min: ctx.duration_min,
        style_notes: ctx.style_notes,
        title,
        series_id: series_id ?? null,
      });
    }

    const { object, modelUsed } = await aiGenerateObject({
      churchId: auth.churchId,
      system: outlineSystemPrompt(ctx),
      prompt:
        "Create a sermon outline with title, intro, 3-5 main points (each with title, summary, optional scripture), application, and closing.",
      schema: sermonOutlineSchema,
    });

    sermon = await updateSermon(sermon.id, {
      title: object.title,
      outline: object,
      model_used: modelUsed,
    });

    return NextResponse.json({ sermon, outline: object, modelUsed });
  } catch (e) {
    console.error("[sermon/outline] failed", e);
    const message = e instanceof Error ? e.message : "Outline generation failed";
    const status = message === "Unauthorized" ? 401 : 500;
    const body: { error: string; detail?: string } = { error: message };
    if (process.env.NODE_ENV !== "production" && e instanceof Error && e.stack) {
      body.detail = e.stack.split("\n").slice(0, 4).join("\n");
    }
    return NextResponse.json(body, { status });
  }
}
