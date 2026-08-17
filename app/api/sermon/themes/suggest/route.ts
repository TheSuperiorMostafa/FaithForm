import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { NextResponse } from "next/server";
import { themeSuggestFromScripturePrompt } from "@/lib/ai/prompts";
import { themeSuggestSchema } from "@/lib/ai/schemas";
import { requireChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import {
  listSlideThemes,
  scoreThemesByScriptureText,
  scoreThemesByTagOverlap,
  type SlideTheme,
} from "@/lib/queries/slide-themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function compactThemeSummary(theme: SlideTheme) {
  return {
    id: theme.id,
    name: theme.name,
    category: theme.category,
    tags: [
      ...theme.tags,
      ...theme.seasonalTags,
      ...theme.symbolTags,
      ...theme.visualStyle,
    ].slice(0, 12),
  };
}

export async function POST(request: Request) {
  try {
    await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;

    const body = (await request.json()) as {
      selectedThemeId?: string;
      context?: { title?: string; scripture?: string; scriptureText?: string };
      refresh?: boolean;
    };

    const selectedThemeId = body.selectedThemeId?.trim();
    // Truncated so a long passage can't blow past the model's context.
    const scriptureText = body.context?.scriptureText?.trim().slice(0, 6000);

    const themes = await listSlideThemes();

    // Passage text is the primary signal: suggestions follow what the verses
    // actually talk about, not whichever theme is currently highlighted.
    if (scriptureText) {
      const fallback = scoreThemesByScriptureText(scriptureText, themes, 6);

      if (process.env.OPENAI_API_KEY) {
        try {
          const result = await generateObject({
            model: openai("gpt-4o-mini"),
            system: themeSuggestFromScripturePrompt(),
            prompt: `Scripture reference: ${body.context?.scripture ?? "unknown"}
${body.context?.title ? `Sermon title: ${body.context.title}\n` : ""}
Passage text:
"""
${scriptureText}
"""

Available themes:
${JSON.stringify(themes.map(compactThemeSummary))}

Return exactly 6 theme IDs whose imagery best matches this passage.`,
            schema: themeSuggestSchema,
            maxOutputTokens: 256,
          });

          const validIds = new Set(themes.map((t) => t.id));
          const suggestions = result.object.suggestions.filter((id) =>
            validIds.has(id),
          );
          if (suggestions.length >= 4) {
            return NextResponse.json({ suggestions: suggestions.slice(0, 6) });
          }
        } catch {
          // Fall through to keyword scoring
        }
      }

      if (fallback.length > 0) {
        return NextResponse.json({ suggestions: fallback });
      }
      // No imagery matched — fall through to theme similarity below.
    }

    if (!selectedThemeId) {
      return NextResponse.json({ suggestions: [] });
    }

    const selected = themes.find((t) => t.id === selectedThemeId);
    if (!selected) {
      return NextResponse.json({ error: "Theme not found" }, { status: 404 });
    }

    return NextResponse.json({
      suggestions: scoreThemesByTagOverlap(selected, themes, 6),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Suggestion failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
