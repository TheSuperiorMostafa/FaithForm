import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { aiGenerateLargeObject } from "@/lib/ai";
import { sermonContentSchema } from "@/lib/ai/schemas";
import { draftSystemPrompt } from "@/lib/ai/prompts";
import { getChurchProfile } from "@/lib/queries/church-profile";
import {
  getChurchAISettings,
  sermonToContext,
  updateSermon,
  verifySermonAccess,
} from "@/lib/queries/sermons";
import { fetchPassages } from "@/lib/scripture/esv";
import { createClient } from "@/lib/supabase/server";
import { featureAccessDenied } from "@/lib/features/guard";
import { SERMON_NOT_FOUND_MESSAGE, sermonRouteError } from "@/lib/sermon-builder/route-error";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const { sermonId } = (await request.json()) as { sermonId: string };

    if (!sermonId) {
      return NextResponse.json({ error: "We couldn't tell which sermon to write. Refresh the page and try again." }, { status: 400 });
    }

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, sermonId, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: SERMON_NOT_FOUND_MESSAGE }, { status: 404 });
    }

    if (!sermon.outline) {
      return NextResponse.json(
        { error: "Make the outline first, then write the full draft." },
        { status: 400 },
      );
    }

    const [settings, profile] = await Promise.all([
      getChurchAISettings(auth.churchId),
      getChurchProfile(auth.churchId, supabase),
    ]);
    const ctx = sermonToContext(sermon, settings, profile);

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
    const raw = e instanceof Error ? e.message : "";
    if (raw.includes("could not parse")) {
      console.error("[sermon/draft] failed", e);
      return NextResponse.json(
        {
          error:
            "The draft came back incomplete. Please try again. If it keeps happening, choose a shorter sermon length.",
        },
        { status: 500 },
      );
    }
    return sermonRouteError(e, "We couldn't write the draft.");
  }
}
