import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { NextResponse } from "next/server";
import { themeSuggestSystemPrompt } from "@/lib/ai/prompts";
import { themeSuggestSchema } from "@/lib/ai/schemas";
import { requireChurchAuth } from "@/lib/auth/church";
import {
  listSlideThemes,
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

    const body = (await request.json()) as {
      selectedThemeId?: string;
      context?: { title?: string; scripture?: string };
      refresh?: boolean;
    };

    const selectedThemeId = body.selectedThemeId?.trim();
    if (!selectedThemeId) {
      return NextResponse.json(
        { error: "selectedThemeId is required" },
        { status: 400 },
      );
    }

    const themes = await listSlideThemes();
    const selected = themes.find((t) => t.id === selectedThemeId);
    if (!selected) {
      return NextResponse.json({ error: "Theme not found" }, { status: 404 });
    }

    const fallback = scoreThemesByTagOverlap(selected, themes, 6);

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ suggestions: fallback });
    }

    try {
      const catalog = themes
        .filter((t) => t.id !== selectedThemeId)
        .map(compactThemeSummary);

      const contextLines = [
        body.context?.title ? `Sermon title: ${body.context.title}` : null,
        body.context?.scripture
          ? `Scripture: ${body.context.scripture}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      const result = await generateObject({
        model: openai("gpt-4o-mini"),
        system: themeSuggestSystemPrompt(),
        prompt: `Selected theme:
${JSON.stringify(compactThemeSummary(selected))}

${contextLines ? `${contextLines}\n\n` : ""}Available themes:
${JSON.stringify(catalog)}

Return exactly 6 theme IDs most similar to the selected theme.`,
        schema: themeSuggestSchema,
        maxOutputTokens: 256,
      });

      const validIds = new Set(themes.map((t) => t.id));
      const suggestions = result.object.suggestions.filter(
        (id) => validIds.has(id) && id !== selectedThemeId,
      );

      if (suggestions.length >= 4) {
        return NextResponse.json({
          suggestions: suggestions.slice(0, 6),
        });
      }
    } catch {
      // Fall through to tag overlap
    }

    return NextResponse.json({ suggestions: fallback });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Suggestion failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
