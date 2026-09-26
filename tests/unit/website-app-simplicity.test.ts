import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  campusSlugFrom,
  defaultCampusTimeZone,
  timeZoneLabel,
} from "@/components/member-app/campus-helpers";
import {
  highlightWords,
  joinHeadline,
  splitHeadline,
} from "@/components/website-admin/headline-text";
import {
  domainInstructionsMailto,
  domainInstructionsText,
  domainStatusWords,
  replyMailto,
} from "@/components/website-admin/website-words";

const read = (path: string) => readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// Headline: one box, highlight kept behind "Highlight some words"
// ---------------------------------------------------------------------------

test("a three-part headline reads as one sentence", () => {
  assert.equal(joinHeadline({ lead: "Welcome", accent: "home", trail: "friend." }), "Welcome home friend.");
  assert.equal(joinHeadline({ lead: "Welcome home." }), "Welcome home.");
  assert.equal(joinHeadline(null), "");
});

test("typing keeps the highlighted words highlighted while they are still there", () => {
  const previous = { lead: "A church for", accent: "everyone", trail: "in town" };
  assert.deepEqual(splitHeadline("A home for everyone in the city", previous), {
    lead: "A home for",
    accent: "everyone",
    trail: "in the city",
  });
});

test("deleting the highlighted words drops the highlight instead of showing deleted text", () => {
  const next = splitHeadline("A church for all", { lead: "A church for", accent: "everyone" });
  assert.equal(next.lead, "A church for all");
  assert.equal(next.accent, "");
  assert.equal(joinHeadline(next), "A church for all");
});

test("choosing words to highlight splits the headline around them, or refuses", () => {
  const parts = { lead: "Welcome to Grace Church" };
  assert.deepEqual(highlightWords(parts, "Grace"), {
    lead: "Welcome to",
    accent: "Grace",
    trail: "Church",
  });
  assert.equal(highlightWords(parts, "Hope"), null);
  assert.equal(joinHeadline(highlightWords(parts, "") ?? {}), "Welcome to Grace Church");
  // Half a word is not highlighted: the parts are joined with spaces.
  assert.equal(highlightWords(parts, "Chur"), null);
  // Punctuation after the highlight stays with it, so no space appears before it.
  const withStop = highlightWords({ lead: "Welcome home." }, "home");
  assert.deepEqual(withStop, { lead: "Welcome", accent: "home.", trail: "" });
  assert.equal(joinHeadline(withStop), "Welcome home.");
});

// ---------------------------------------------------------------------------
// Web address words and the "email these steps" link
// ---------------------------------------------------------------------------

test("web address statuses use the plain vocabulary", () => {
  assert.equal(domainStatusWords("live", true).label, "Connected");
  assert.equal(domainStatusWords("pending_dns", true).label, "Waiting for your domain company");
  assert.equal(domainStatusWords("failed", false).tone, "attention");
  for (const status of ["live", "dns_ok", "pending_dns", "failed"] as const) {
    assert.doesNotMatch(domainStatusWords(status, false).label, /DNS|dns_ok|pending/);
  }
});

test("the domain instructions email carries every record and leaves the recipient blank", () => {
  const records = [
    { type: "A" as const, name: "@", value: "76.76.21.21", note: "Points grace.org at FaithForm." },
    { type: "CNAME" as const, name: "www", value: "cname.vercel-dns.com", note: "Makes www work." },
  ];
  const text = domainInstructionsText({ hostname: "grace.org", records, churchName: "Grace Church" });
  assert.match(text, /Grace Church/);
  assert.match(text, /76\.76\.21\.21/);
  assert.match(text, /cname\.vercel-dns\.com/);
  assert.match(text, /MX/);

  const mailto = domainInstructionsMailto({ hostname: "grace.org", records });
  assert.ok(mailto.startsWith("mailto:?subject="));
  assert.match(decodeURIComponent(mailto), /76\.76\.21\.21/);
});

test("Reply opens a prefilled email to the visitor", () => {
  const href = replyMailto({ email: "ann@example.com", name: "Ann Lee", churchName: "Grace" });
  assert.ok(href.startsWith("mailto:ann@example.com?subject="));
  assert.match(decodeURIComponent(href), /Re: Your message to Grace/);
  assert.match(decodeURIComponent(href), /Hi Ann,/);
});

// ---------------------------------------------------------------------------
// Campus form defaults
// ---------------------------------------------------------------------------

test("a campus web-address name is made from its name", () => {
  assert.equal(campusSlugFrom("East Campus"), "east-campus");
  assert.equal(campusSlugFrom("  St. Mary's & Café  "), "st-mary-s-and-cafe");
  assert.match(campusSlugFrom("North Side"), /^[a-z0-9][a-z0-9-]*$/);
});

test("a new campus starts in the church's own time zone", () => {
  assert.equal(
    defaultCampusTimeZone([{ timezone: "America/Chicago", isPrimary: true }], "America/Denver"),
    "America/Chicago",
  );
  assert.equal(defaultCampusTimeZone([], "America/Denver"), "America/Denver");
  assert.equal(defaultCampusTimeZone([], null), "America/New_York");
  assert.equal(timeZoneLabel("America/Chicago"), "Central time");
});

// ---------------------------------------------------------------------------
// Wiring: destructive actions ask first, words are plain
// ---------------------------------------------------------------------------

test("Website has five tabs and the old routes still land", () => {
  const layout = read("app/dashboard/website/layout.tsx");
  const tabs = layout.match(/\{ label: "/g) ?? [];
  assert.ok(tabs.length <= 5, `expected at most 5 tabs, found ${tabs.length}`);
  assert.match(layout, /label: "Inbox"/);
  assert.match(layout, /label: "Look & Details"/);
  assert.doesNotMatch(layout, /label: "Messages"/);
  assert.match(read("app/dashboard/website/messages/page.tsx"), /redirect\("\/dashboard\/website\/inbox"\)/);
  assert.match(read("app/dashboard/website/design/page.tsx"), /redirect\("\/dashboard\/website\/details#look"\)/);
});

test("deleting a sermon is labelled, confirmed, and never called a message", () => {
  const media = read("components/website-admin/media-table.tsx");
  assert.match(media, /confirmAction\(/);
  assert.match(media, /confirmLabel: "Delete sermon"/);
  assert.doesNotMatch(media, /Message removed|Add message|New message/);
  const actions = read("app/dashboard/website/actions.ts");
  assert.match(actions, /That sermon does not belong to your church\./);
  assert.doesNotMatch(actions, /That message could not be (saved|removed)/);
});

test("taking the site offline, resetting a section and switching theme are guarded", () => {
  const publish = read("components/website-admin/publish-card.tsx");
  assert.match(publish, /confirmLabel: "Take website offline"/);

  const sections = read("components/website-admin/section-list.tsx");
  assert.match(sections, /confirmAction\(/);
  assert.match(sections, /undoToast\(/);
  assert.match(sections, /Move up/);
  assert.doesNotMatch(sections, /size-6|text-\[10px\]/);

  const design = read("components/website-admin/design-form.tsx");
  assert.match(design, /confirmAction\(/);
  assert.match(design, /undoToast\(/);
  assert.match(design, /Your live website changes now/);
});

test("removing a service time or a person says what else changes", () => {
  const details = read("components/website-admin/details-form.tsx");
  assert.match(details, /attendance/);
  assert.match(details, /confirmLabel: "Remove service"/);
  assert.match(details, /confirmLabel: "Remove person"/);
  assert.match(read("components/member-app/church-info-editor.tsx"), /confirmLabel: "Remove service"/);
});

test("domain changes are confirmed and never show raw errors", () => {
  const workspace = read("components/website-admin/domain-workspace.tsx");
  assert.match(workspace, /confirmLabel: "Cancel request"/);
  assert.match(workspace, /confirmLabel: "Remove web address"/);
  assert.match(workspace, /Email these steps to the person who manages our domain/);
  assert.match(workspace, /Let FaithForm do it for me/);
  assert.match(workspace, /Technical details/);

  const actions = read("app/dashboard/website/domain-actions.ts");
  assert.doesNotMatch(actions, /fail\(error\.message\)|error: error\.message|error: registered\.error/);
  assert.match(actions, /export async function removeDomain/);
  // The removal is scoped to the caller's church and admin-only, like the rest.
  const remove = actions.slice(actions.indexOf("export async function removeDomain"));
  assert.match(remove, /guardAdmin\(\)/);
  assert.match(remove, /\.eq\("church_id", auth\.churchId\)/);
});

test("the section editor speaks plainly", () => {
  const hero = read("components/sites/sections/hero.tsx");
  assert.match(hero, /label: "Banner"/);
  assert.doesNotMatch(hero, /label: "Eyebrow"/);
  assert.match(read("components/sites/sections/site-nav.tsx"), /label: "Menu"/);
  assert.match(read("components/sites/sections/custom-embed.tsx"), /label: "Text block"/);
  assert.doesNotMatch(read("components/sites/sections/site-nav.tsx"), /#about/);

  const form = read("components/website-admin/section-fields-form.tsx");
  assert.match(form, /Highlight some words/);
  assert.doesNotMatch(form, /Emphasised words|Words after the emphasis/);
});

test("the Church App page has no migration jargon and keeps the links contract", () => {
  const actions = read("app/dashboard/app/actions.ts");
  assert.doesNotMatch(actions, /migration 0090/);
  assert.match(actions, /Links aren't available for your church yet\. Everything else was saved\./);
  // Settings › Church info relies on this field prefix to tell a links-only failure apart.
  assert.match(actions, /"quickLinks",\n\s*\);/);

  const editor = read("components/member-app/church-info-editor.tsx");
  assert.doesNotMatch(editor, /migration 0090|text-\[11px\]|size="icon-sm"/);
  assert.match(editor, /Also shown in Settings → Church info\./);

  const campus = read("components/member-app/app-visibility-card.tsx");
  assert.match(campus, /confirmLabel: "Retire campus"/);
  assert.match(campus, /<AdvancedSection/);
});

test("the inbox has Reply and readable sender details", () => {
  const inbox = read("components/website-admin/submissions-inbox.tsx");
  assert.match(inbox, /replyMailto\(/);
  assert.match(inbox, /Reply/);
  assert.doesNotMatch(inbox, /text-xs/);
});
