import assert from "node:assert/strict";
import test from "node:test";

import { visitCtaSection } from "@/components/sites/sections/visit-cta";
import { buildSections } from "@/lib/sites/generate";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { diffPatch, resolvePage } from "@/lib/sites/resolve";
import { editableSectionContent } from "@/lib/sites/section-input";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";
import type { SiteLayoutMode, SiteProfile, SiteSectionRow } from "@/types/site";

const nameOnlyProfile: SiteProfile = {
  slug: "visitor-facts-qa",
  name: "Visitor Facts QA Church",
  tagline: null,
  description: null,
  missionStatement: null,
  visionStatement: null,
  denomination: null,
  logoUrl: null,
  coverImageUrl: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  phone: null,
  email: null,
  googleMapsUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  youtubeUrl: null,
  tiktokUrl: null,
  xUrl: null,
  livestreamUrl: null,
  serviceTimes: [],
  staff: [],
  events: [],
  media: [],
  givingEnabled: false,
};

// Reproduce an otherwise valid model response from the former schema. Even if
// an AI provider returns these extra fields, creation must never persist them.
const ungroundedCopy = {
  metaDescription: "Visit Visitor Facts QA Church.",
  hero: { eyebrow: "Welcome", headlineLead: "Come and", headlineAccent: "visit", body: "Welcome to Visitor Facts QA Church." },
  about: { eyebrow: "About", headlineLead: "Our", headlineAccent: "church", headlineTrail: "", paragraphs: [], stats: [] },
  vision: { eyebrow: "Our church", visionBody: "", missionBody: "" },
  staff: { eyebrow: "Our people", note: "" },
  programs: { eyebrow: "Gatherings", headline: "Gather with us", items: [] },
  visit: {
    eyebrow: "Your first Sunday",
    headline: "Coffee and childcare are ready",
    body: "We have no dress code and free coffee for everyone.",
    facts: [
      { title: "Kids", body: "Childcare is available during every service." },
      { title: "Dress", body: "There is no dress code." },
      { title: "Coffee", body: "Free coffee is ready when you arrive." },
      { title: "Parking", body: "Accessible parking is available by the door." },
    ],
  },
  give: { eyebrow: "Give", headlineLead: "Give", headlineAccent: "together", body: "" },
  footerBlurb: "Visitor Facts QA Church",
} satisfies NonNullable<Parameters<typeof buildSections>[1]> & { visit: {
  eyebrow: string; headline: string; body: string; facts: { title: string; body: string }[];
} };

function resolveVisit(
  sections: SiteSectionRow[],
  theme = CODE_SITE_THEMES.grace,
  layoutMode: SiteLayoutMode = "landing",
  patch?: Record<string, unknown>,
) {
  const visit = sections.find((section) => section.type === "visit_cta")!;
  return resolvePage({
    page: { id: "home", path: "/", title: null, metaDescription: null, status: "draft" },
    theme,
    settings: { themeKey: theme.key, brandTokens: {}, customCss: null, contactEmail: null, isPublished: false, layoutMode },
    profile: nameOnlyProfile,
    sections,
    overrides: patch ? [{ scope: "section", sectionId: visit.id, pageId: null, patch }] : [],
    registry: SECTION_REGISTRY,
  }).sections.find((section) => section.type === "visit_cta")!.content;
}

test("name-only generation ignores invented AI visitor guidance in every theme and layout", () => {
  const before = JSON.stringify(ungroundedCopy);
  for (const mode of ["landing", "website"] as const) {
    const draft = buildSections(nameOnlyProfile, ungroundedCopy, mode);
    const sections = draft.sections.map((section, index) => ({ ...section, id: `section-${index}`, sortOrder: index }));
    assert.deepEqual(sections.find((section) => section.type === "visit_cta")!.props, { anchor: "visit" });
    for (const theme of Object.values(CODE_SITE_THEMES)) {
      const content = resolveVisit(sections, theme, mode);
      assert.deepEqual(content.facts, [], `${theme.key}/${mode}`);
      assert.equal(content.body, null);
      assert.doesNotMatch(JSON.stringify(content), /childcare|dress code|coffee|parking/i);
      assert.equal((content.form as { endpoint: string }).endpoint, "/api/sites/contact?site=visitor-facts-qa");
    }
  }
  assert.equal(JSON.stringify(ungroundedCopy), before, "generation must not mutate supplied content");
});

test("AI-unavailable creation resolves safe visitor defaults without requiring profile details", () => {
  const sections = buildSections(nameOnlyProfile, null).sections.map((section, index) => ({ ...section, id: `section-${index}`, sortOrder: index }));
  const content = resolveVisit(sections);
  assert.deepEqual(content.facts, []);
  assert.equal(content.body, null);
  assert.equal((content.form as { enabled: boolean }).enabled, true);
});

test("stored and manually edited visitor facts keep their existing resolution and save contract", () => {
  const storedFacts = [{ icon: "♥", title: "Children", body: "Our church's confirmed family arrangements." }];
  const section: SiteSectionRow = {
    id: "existing-visit", type: "visit_cta", sortOrder: 0, isVisible: true,
    props: { anchor: "visit", body: "Our saved visitor introduction.", facts: storedFacts },
  };
  const before = JSON.stringify(section);
  const baseline = resolveVisit([section]);
  assert.deepEqual(baseline.facts, storedFacts);
  assert.equal(baseline.body, section.props.body);

  const manualFacts = [{ icon: "i", title: "Ask us", body: "Please contact us about your family's needs." }];
  const edited = editableSectionContent(visitCtaSection.fields!, baseline, { ...baseline, facts: manualFacts });
  const savedPatch = diffPatch(baseline, edited);
  assert.deepEqual(resolveVisit([section], undefined, undefined, savedPatch).facts, manualFacts);
  assert.deepEqual(resolveVisit([section], undefined, undefined, { facts: [] }).facts, []);
  assert.deepEqual(resolveVisit([section]).facts, storedFacts, "reset still returns to the church's existing stored content");
  assert.equal(JSON.stringify(section), before, "existing stored content must remain untouched");
});
