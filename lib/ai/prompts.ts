import type { SermonContext } from "@/types/sermon";

function contextBlock(ctx: SermonContext): string {
  return [
    `Topic: ${ctx.topic}`,
    `Scripture: ${ctx.scripture_refs.join(", ") || "Not specified"}`,
    `Audience: ${ctx.audience}`,
    `Duration: ${ctx.duration_min} minutes`,
    ctx.preaching_style ? `Preaching style: ${ctx.preaching_style}` : null,
    ctx.denomination ? `Denomination/tradition: ${ctx.denomination}` : null,
    ctx.style_notes ? `Additional notes: ${ctx.style_notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
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

Write in a warm, pastoral voice for spoken delivery (~${ctx.duration_min} minutes preached).
Do NOT wrap JSON in markdown code fences. Output raw JSON only.

${contextBlock(ctx)}

Outline:
${outlineJson}
${scriptureText ? `\nScripture text:\n${scriptureText}` : ""}`;
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
${ctx?.preaching_style ? `Style: ${ctx.preaching_style}` : ""}`;
}

export function themeSuggestSystemPrompt(): string {
  return `You recommend visually and thematically similar PowerPoint slide background themes for church sermon decks.
Given one selected theme and a catalog of available themes (id, name, category, tags), return exactly 6 theme IDs ranked by similarity.
Prefer matching category, seasonal context, visual style, and symbol tags.
Do not include the selected theme ID in results.
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
