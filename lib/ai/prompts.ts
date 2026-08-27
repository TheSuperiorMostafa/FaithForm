import type { ChurchProfile } from "@/types/church-profile";
import type { SermonContext } from "@/types/sermon";

function contextBlock(ctx: SermonContext): string {
  return [
    `Topic: ${ctx.topic}`,
    `Scripture: ${ctx.scripture_refs.join(", ") || "Not specified"}`,
    ctx.church_summary ? `Church: ${ctx.church_summary}` : null,
    ctx.preaching_style ? `Preaching style: ${ctx.preaching_style}` : null,
    ctx.denomination ? `Denomination/tradition: ${ctx.denomination}` : null,
    ctx.church_culture ? `Congregation culture: ${ctx.church_culture}` : null,
    ctx.style_notes ? `Additional notes: ${ctx.style_notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSermonProfileContext(profile: ChurchProfile | null): {
  denomination: string | null;
  church_summary: string | null;
  church_culture: string | null;
} {
  if (!profile) {
    return {
      denomination: null,
      church_summary: null,
      church_culture: null,
    };
  }

  const summary =
    profile.aiKnowledge.summary?.trim() ||
    profile.description?.trim() ||
    profile.tagline?.trim() ||
    profile.name;

  return {
    denomination: profile.denomination,
    church_summary: summary || null,
    church_culture: profile.aiKnowledge.culture?.trim() || null,
  };
}

export function outlineSystemPrompt(ctx: SermonContext): string {
  return `You are an expert sermon architect helping pastors prepare biblical, Christ-centered sermons.
Write a clear sermon outline in valid JSON matching the schema provided.
Use expository principles: anchor each point in Scripture, keep application practical, and honor the congregation's context.

${contextBlock(ctx)}`;
}

export function draftSystemPrompt(
  ctx: SermonContext,
  outlineJson: string,
  scriptureText?: string,
): string {
  return `You are an expert sermon writer. Expand the outline into a full sermon manuscript.

Return a single JSON object with these keys only:
- intro (string, 2-3 short paragraphs)
- points (array of {title, body} — one entry per outline point; each body ~150-220 words, spoken tone)
- illustrations (array of 2-3 strings — brief story titles or one-sentence hooks)
- application (string, 2 paragraphs)
- prayer (string, 1 paragraph)

Write in a warm, pastoral voice for spoken delivery.
Do NOT wrap JSON in markdown code fences. Output raw JSON only.

${contextBlock(ctx)}

Outline:
${outlineJson}
${scriptureText ? `\nScripture text:\n${scriptureText}` : ""}`;
}

/**
 * One call for the whole lesson: outline plus small-group questions. Written
 * as a single prompt so the questions come from the outline the model just
 * wrote, the same way the two-step flow fed the saved outline back in.
 */
export function lessonSystemPrompt(ctx: SermonContext): string {
  return `You are an expert sermon architect helping pastors prepare biblical, Christ-centered lessons.
Return valid JSON matching the schema provided, with two parts:
1. "outline" — a clear sermon outline (title, intro, 3-5 main points each with title, summary, optional scripture, application, closing). Use expository principles: anchor each point in Scripture, keep application practical, and honor the congregation's context.
2. "questions" — 6-8 small-group discussion questions across categories warmup, observation, interpretation, application. Open-ended, tied directly to the outline above.

${contextBlock(ctx)}`;
}

export function discussionSystemPrompt(
  ctx: SermonContext,
  sermonSummary: string,
): string {
  return `You create small-group discussion guides for church sermons.
Generate 6-8 questions across categories: warmup, observation, interpretation, application.
Questions should be open-ended and tie directly to the sermon.

${contextBlock(ctx)}

Sermon summary:
${sermonSummary}`;
}

export function socialSystemPrompt(
  ctx: SermonContext,
  sermonSummary: string,
  channels: string[],
): string {
  return `You write church social media and email copy that is inviting, not clickbait.
Channels requested: ${channels.join(", ")}.
Keep Instagram under 2200 chars, Twitter/X under 280 chars, Facebook friendly and medium length, email blurb 2-3 sentences.

${contextBlock(ctx)}

Sermon summary:
${sermonSummary}`;
}

export type EventSocialContext = {
  churchName: string;
  title: string;
  when: string;
  location: string;
  notes?: string;
};

export function eventSocialSystemPrompt(ctx: EventSocialContext): string {
  return `You write Facebook posts for local church events. The copy should feel warm, inviting, and authentic — like a real church staff member wrote it, not a marketing bot.

Rules:
- facebookCaption: Just 1-2 short, warm sentences that invite people to the event and capture why it matters. The date, time, and location already appear ON the graphic, so do NOT list them out — you may mention the day casually (e.g. "this Sunday"), but ONLY using the weekday given below under "When". Never infer, calculate, or guess a weekday, and never state a date or time that is not written there. Conversational and genuine. No hashtags. Keep it under 280 characters.
- headline: The LARGE display title on a premium cinematic event flyer. This is the hero text — it must feel polished and intentional, never generic or keyword-stuffed.
  * Preserve the full event name when it already reads well (e.g. keep "Coffee with the Pastor", NOT "Coffee Pastor").
  * Use the event's natural phrasing — connecting words like "with the", "Night", "Men's", etc. are part of the brand.
  * Good examples: "Coffee with the Pastor", "Men's Prayer Breakfast", "Sunday Night Prayer Service", "Youth Worship Night".
  * Bad examples: "Coffee Pastor", "Prayer Event", "Church Meeting", "Community Gathering" (too vague).
  * Max 48 characters. Prefer 3-6 words when the event name supports it.
- backgroundTag: Pick exactly one tag that best matches the event mood from: youth, worship, outreach, community, prayer, bible-study, fellowship, seasonal-christmas, seasonal-easter, family, missions, default.
- templateKey: Pick one layout style from: general, youth, outreach, worship-night. Use "general" unless the event clearly fits a themed category.

Church: ${ctx.churchName}
Event title: ${ctx.title}
When: ${ctx.when}
Where: ${ctx.location || "See announcement for details"}
${ctx.notes?.trim() ? `Extra notes: ${ctx.notes.trim()}` : ""}`;
}

export function seriesSystemPrompt(
  title: string,
  theme: string,
  weeksPlanned: number,
  scriptureAnchor: string,
  ctx?: Partial<SermonContext>,
): string {
  return `You plan multi-week sermon series for local churches.
Create a ${weeksPlanned}-week series plan. Each week needs: week number, title, primary scripture reference, and exactly 3 theme bullets.

Series title: ${title}
Theme: ${theme}
Anchor scripture: ${scriptureAnchor}
${ctx?.denomination ? `Denomination: ${ctx.denomination}` : ""}
${ctx?.church_summary ? `Church: ${ctx.church_summary}` : ""}
${ctx?.church_culture ? `Culture: ${ctx.church_culture}` : ""}
${ctx?.preaching_style ? `Style: ${ctx.preaching_style}` : ""}`;
}

export function themeSuggestSystemPrompt(): string {
  return `You recommend PowerPoint slide background themes for church sermon decks.
Given a catalog of available themes (id, name, category, tags), return exactly 6 theme IDs ranked best-first.
Output valid JSON only.`;
}

/**
 * Themes are suggested from what the chosen verses actually say — a passage
 * about water should surface water imagery — not from whichever theme the user
 * happens to have highlighted.
 */
export function themeSuggestFromScripturePrompt(): string {
  return `You recommend PowerPoint slide background themes for church sermon decks.
You are given the literal text of the scripture passage the preacher selected, plus a catalog of available themes (id, name, category, tags).
Identify the concrete imagery, setting, mood, and symbols present in the passage text — water, light, bread, desert, storm, harvest, shepherd, cross, and so on — and return exactly 6 theme IDs whose imagery and tags best match that passage.
Weight literal imagery in the passage above abstract topical association.
Output valid JSON only.`;
}

export function sectionRegeneratePrompt(
  section: string,
  ctx: SermonContext,
  currentContent: string,
): string {
  return `Regenerate only the "${section}" section of this sermon. Keep tone and theology consistent with the rest.

${contextBlock(ctx)}

Current sermon context:
${currentContent}`;
}
