import { z } from "zod";

import { aiGenerateObject } from "@/lib/ai";
import { formatDayAndTime } from "@/lib/sites/format";
import type { SiteProfile } from "@/types/site";

/**
 * First-draft website generation.
 *
 * Two layers, deliberately separated:
 *
 * - **Structure is deterministic.** Which sections exist, their order, and
 *   which are hidden are decided in code from what the profile actually
 *   contains. A church with no staff doesn't get an empty team grid; a church
 *   without Stripe doesn't get a Give button that leads nowhere.
 *
 * - **Copy is AI-written, and optional.** Only the words that cannot be derived
 *   from the profile — the hero hook, the welcome paragraphs, program blurbs —
 *   go to the model. If that call fails, or no API key is configured, the site
 *   still builds: every field falls back to the master defaults and the
 *   profile-derived content underneath.
 *
 * That split is what makes "Build my website" safe to put behind a button. The
 * worst case is a plainer first draft, never a failed build.
 */

// ---------------------------------------------------------------------------
// AI COPY
// ---------------------------------------------------------------------------

/**
 * Deliberately free of length constraints.
 *
 * Anthropic's structured outputs do not enforce `minLength`/`maxLength`, so a
 * `.max()` here is validated client-side only — the model returns a sensible
 * but slightly-too-long string and the whole generation is rejected, falling
 * back to defaults for the sake of a few characters. Lengths are requested in
 * the prompt and capped in code where the design actually requires it.
 */
const CopySchema = z.object({
  metaDescription: z.string(),
  hero: z.object({
    eyebrow: z.string(),
    headlineLead: z.string(),
    headlineAccent: z.string(),
    body: z.string(),
  }),
  about: z.object({
    eyebrow: z.string(),
    headlineLead: z.string(),
    headlineAccent: z.string(),
    headlineTrail: z.string(),
    paragraphs: z.array(z.string()),
    stats: z.array(z.object({ value: z.string(), label: z.string() })),
  }),
  vision: z.object({
    eyebrow: z.string(),
    visionBody: z.string(),
    missionBody: z.string(),
  }),
  staff: z.object({ eyebrow: z.string(), note: z.string() }),
  programs: z.object({
    eyebrow: z.string(),
    headline: z.string(),
    items: z.array(
      z.object({ when: z.string(), title: z.string(), body: z.string() }),
    ),
  }),
  visit: z.object({
    eyebrow: z.string(),
    headline: z.string(),
    body: z.string(),
    facts: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  give: z.object({
    eyebrow: z.string(),
    headlineLead: z.string(),
    headlineAccent: z.string(),
    body: z.string(),
  }),
  footerBlurb: z.string(),
});

type Copy = z.infer<typeof CopySchema>;

const SYSTEM = `You write copy for small church websites.

Write like a person who actually attends. Warm, plain, specific to this church.
Never generic filler ("we are a welcoming community of believers"), never
marketing hype, never exclamation marks.

Headlines split into a lead and an accented word or short phrase. The accent
renders in a serif italic, so it should be one evocative word or a very short
phrase that reads well emphasised — "welcome.", "glad", "table." — not a clause.

Only state facts you were given. Do not invent service times, staff names,
ministries, history, or numbers. If you do not know something, write around it.`;

function profileBrief(profile: SiteProfile): string {
  const lines: string[] = [`Church name: ${profile.name}`];

  const add = (label: string, value: string | null) => {
    if (value?.trim()) lines.push(`${label}: ${value.trim()}`);
  };

  add("Denomination", profile.denomination);
  add("Tagline", profile.tagline);
  add("Description", profile.description);
  add("Mission statement", profile.missionStatement);
  add("Vision statement", profile.visionStatement);
  add(
    "Location",
    [profile.address, profile.city, profile.state].filter(Boolean).join(", ") ||
      null,
  );

  if (profile.serviceTimes.length > 0) {
    lines.push(
      "Service times:",
      ...profile.serviceTimes.map(
        (t) => `  - ${t.label}: ${formatDayAndTime(t.dayOfWeek, t.startTime)}`,
      ),
    );
  }

  if (profile.staff.length > 0) {
    lines.push(
      "Staff:",
      ...profile.staff.map((s) => `  - ${s.name}${s.title ? ` (${s.title})` : ""}`),
    );
  }

  return lines.join("\n");
}

/**
 * The mission and vision statements churches store are often long, internal,
 * multi-paragraph texts written for staff or the AI assistant. The website
 * needs the one-line version, so the model is asked to distil rather than quote.
 */
function copyPrompt(profile: SiteProfile): string {
  return `Write the first draft of this church's website copy.

${profileBrief(profile)}

Notes:
- The about paragraphs should say what this church is actually like, drawing on
  the description and statements above. One or two paragraphs.
- For the vision and mission cards, distil the statements above into one short
  sentence each. Do not quote them at length.
- Stats are optional. Only include ones you can support from the facts above
  (for example the number of weekly gatherings). Return an empty array if you
  cannot support any. Never invent a founding year or a congregation size.
- Programs should reflect the service times listed above, plus any ministries
  the description mentions. Do not invent programs that were not mentioned.
- Visit facts are practical things a first-time visitor wants to know. Generic
  hospitality points are fine here (arriving early, dress, kids, coffee) as long
  as they do not assert specifics you were not told. Give exactly four.

Lengths (guidance, not hard limits — the layout is built for roughly these):
- eyebrows: 2-5 words
- headline leads: under 8 words; accents: one or two words
- hero and section intros: 1-2 sentences
- about paragraphs: 2-4 sentences each, at most two paragraphs
- card and fact bodies: one sentence
- meta description: around 150 characters`;
}

async function generateCopy(
  churchId: string,
  profile: SiteProfile,
): Promise<Copy | null> {
  try {
    const { object } = await aiGenerateObject({
      churchId,
      system: SYSTEM,
      prompt: copyPrompt(profile),
      schema: CopySchema,
      maxOutputTokens: 4096,
    });
    return object;
  } catch (error) {
    // A missing API key, a rate limit, or a schema mismatch must not stop a
    // church from getting a website. Structure alone still produces a real page.
    // Log the provider's own fields — a bare message here is "Not Found" with
    // no indication of which model or URL was rejected.
    const detail = error as {
      message?: string;
      url?: string;
      statusCode?: number;
      responseBody?: string;
      cause?: unknown;
    };
    console.error("[sites] copy generation failed, using defaults:", {
      message: detail?.message,
      status: detail?.statusCode,
      url: detail?.url,
      body: detail?.responseBody?.slice(0, 400),
      // The schema-mismatch case carries the validation issues on `cause`;
      // without it the message is just "did not match schema".
      cause: detail?.cause instanceof Error ? detail.cause.message : detail?.cause,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// STRUCTURE
// ---------------------------------------------------------------------------

export type GeneratedSection = {
  type: string;
  isVisible: boolean;
  props: Record<string, unknown>;
};

export type GeneratedSite = {
  title: string;
  metaDescription: string | null;
  sections: GeneratedSection[];
  /** False when the copy fell back to defaults, so the UI can say so. */
  aiCopyUsed: boolean;
};

function badgeFor(title: string): string {
  return title.trim().charAt(0).toUpperCase() || "•";
}

export async function generateSite(
  churchId: string,
  profile: SiteProfile,
): Promise<GeneratedSite> {
  const copy = await generateCopy(churchId, profile);
  return { ...buildSections(profile, copy), aiCopyUsed: copy !== null };
}

/**
 * The deterministic half: which sections exist, in what order, and which start
 * hidden. Pure — no I/O — so `copy: null` is exactly the AI-unavailable path.
 */
export function buildSections(
  profile: SiteProfile,
  copy: Copy | null,
): Omit<GeneratedSite, "aiCopyUsed"> {
  const hasStaff = profile.staff.length > 0;
  const hasTimes = profile.serviceTimes.length > 0;
  const hasStatements = Boolean(profile.missionStatement || profile.visionStatement);

  // Programs fall back to the service times, which the profile always knows.
  // Counts are capped here rather than in the schema: the layout is a 3-column
  // grid, and rejecting a whole generation because the model wrote a seventh
  // program would trade good copy for no copy.
  const programItems =
    copy?.programs.items.slice(0, 6).map((item) => ({
      badge: badgeFor(item.title),
      when: item.when,
      title: item.title,
      body: item.body,
    })) ??
    profile.serviceTimes.map((time) => ({
      badge: badgeFor(time.label),
      when: formatDayAndTime(time.dayOfWeek, time.startTime),
      title: time.label,
      body: time.notes ?? "",
    }));

  const navLinks = [
    { label: "About", href: "#about" },
    ...(hasStatements ? [{ label: "Vision", href: "#vision" }] : []),
    ...(hasStaff ? [{ label: "Staff", href: "#staff" }] : []),
    ...(programItems.length > 0 ? [{ label: "Programs", href: "#programs" }] : []),
    ...(profile.media.length > 0 ? [{ label: "Sermons", href: "#sermons" }] : []),
    ...(profile.givingEnabled ? [{ label: "Give", href: "#give" }] : []),
  ];

  const sections: GeneratedSection[] = [
    {
      type: "site_nav",
      isVisible: true,
      props: {
        anchor: "top",
        links: navLinks,
        cta: { label: "Visit", href: "#visit", variant: "solid" },
      },
    },
    {
      type: "hero",
      isVisible: true,
      props: {
        anchor: "top-hero",
        ...(copy
          ? {
              eyebrow: copy.hero.eyebrow.toUpperCase(),
              headline: {
                lead: copy.hero.headlineLead,
                accent: copy.hero.headlineAccent,
              },
              body: copy.hero.body,
            }
          : {}),
        // No `src` on purpose. Writing the profile's cover URL here would bake
        // a derived value into the config layer, which sits *after* derive() in
        // the cascade — a cover photo added later would then be permanently
        // shadowed by whatever the value was at build time. Only the caption
        // shown while there is no photo belongs in the config.
        image: { alt: "", placeholder: "a photo of your congregation" },
        actions: [
          { label: "Plan your visit", href: "#visit", variant: "solid" },
          ...(profile.media.length > 0
            ? [{ label: "Latest sermon", href: "#sermons", variant: "outline" }]
            : []),
        ],
      },
    },
    {
      type: "service_times",
      isVisible: hasTimes,
      props: { anchor: "times" },
    },
    {
      type: "about_text",
      isVisible: true,
      props: {
        anchor: "about",
        ...(copy
          ? {
              eyebrow: copy.about.eyebrow,
              headline: {
                lead: copy.about.headlineLead,
                accent: copy.about.headlineAccent,
                trail: copy.about.headlineTrail,
              },
              body: copy.about.paragraphs.slice(0, 2),
              stats: copy.about.stats.slice(0, 3),
            }
          : {}),
        // Same reasoning as the hero: derive() owns `src`.
        image: {
          alt: "",
          placeholder: "a photo of your building or a Sunday gathering",
        },
      },
    },
    {
      type: "vision_mission",
      isVisible: hasStatements,
      props: {
        anchor: "vision",
        ...(copy
          ? {
              eyebrow: copy.vision.eyebrow,
              // Distilled, not quoted — the full statements stay in the profile.
              cards: [
                ...(profile.visionStatement
                  ? [
                      {
                        badge: "V",
                        title: "Our Vision",
                        body: copy.vision.visionBody,
                      },
                    ]
                  : []),
                ...(profile.missionStatement
                  ? [
                      {
                        badge: "M",
                        title: "Our Mission",
                        body: copy.vision.missionBody,
                      },
                    ]
                  : []),
              ],
            }
          : {}),
      },
    },
    {
      type: "staff_grid",
      isVisible: hasStaff,
      props: {
        anchor: "staff",
        ...(copy ? { eyebrow: copy.staff.eyebrow, note: copy.staff.note } : {}),
      },
    },
    {
      type: "programs_grid",
      isVisible: programItems.length > 0,
      props: {
        anchor: "programs",
        items: programItems,
        ...(copy
          ? {
              eyebrow: copy.programs.eyebrow,
              headline: { lead: copy.programs.headline },
            }
          : {}),
      },
    },
    {
      type: "visit_cta",
      isVisible: true,
      props: {
        anchor: "visit",
        ...(copy
          ? {
              eyebrow: copy.visit.eyebrow,
              headline: { lead: copy.visit.headline },
              body: copy.visit.body,
              facts: copy.visit.facts.slice(0, 4).map((fact, i) => ({
                // The model writes the words; the icons stay ours so the design
                // holds regardless of what it returns.
                icon: ["⌚", "★", "♥", "☕"][i] ?? "•",
                title: fact.title,
                body: fact.body,
              })),
            }
          : {}),
      },
    },
    {
      type: "sermon_feed",
      // Hidden until there is something to show; the church turns it on from
      // Website → Pages once they add their first message.
      isVisible: profile.media.length > 0,
      props: { anchor: "sermons" },
    },
    {
      type: "give_cta",
      // Hidden without Stripe — a Give button that goes nowhere is worse than
      // no Give button.
      isVisible: profile.givingEnabled,
      props: {
        anchor: "give",
        ...(copy
          ? {
              eyebrow: copy.give.eyebrow,
              headline: {
                lead: copy.give.headlineLead,
                accent: copy.give.headlineAccent,
              },
              body: copy.give.body,
            }
          : {}),
      },
    },
    {
      type: "footer_map",
      isVisible: true,
      props: {
        anchor: "footer",
        ...(copy ? { blurb: copy.footerBlurb } : {}),
        extraColumns: [
          {
            heading: "Explore",
            links: [
              { label: "About us", href: "#about" },
              ...(profile.media.length > 0
                ? [{ label: "Sermons", href: "#sermons" }]
                : []),
              ...(profile.givingEnabled ? [{ label: "Give", href: "#give" }] : []),
              { label: "Plan a visit", href: "#visit" },
            ],
          },
        ],
      },
    },
  ];

  return {
    title: profile.name,
    metaDescription: copy?.metaDescription ?? profile.tagline ?? profile.description,
    sections,
  };
}
