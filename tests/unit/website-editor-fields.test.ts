import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { DesignForm } from "../../components/website-admin/design-form";
import { DetailsForm } from "../../components/website-admin/details-form";
import { DomainWorkspace } from "../../components/website-admin/domain-workspace";
import { PublishCard } from "../../components/website-admin/publish-card";
import { MediaTable } from "../../components/website-admin/media-table";
import { rollbackInboxStatus } from "../../components/website-admin/inbox-state";
import { EditorField } from "../../components/website-admin/editor-field";
import { blankSectionItem, clearBrandToken, moveSectionListItem } from "../../components/website-admin/field-values";
import { SECTION_REGISTRY } from "../../lib/sites/registry";
import { DEV_PREVIEW_PROFILE } from "../../lib/sites/dev-preview-profile";
import { diffPatch, resolveSectionBaseline } from "../../lib/sites/resolve";
import { CODE_SITE_THEMES } from "../../lib/sites/themes";
import type { SectionField } from "../../lib/sites/contract";

Object.assign(globalThis, { React });

test("visible field names and help are attached to the actual input", () => {
  const html = renderToStaticMarkup(createElement(EditorField, { label: "Church name", help: "Shown on the website.", required: true }, createElement("input", { type: "text" })));
  const labelTarget = /<label[^>]*for="([^"]+)"/.exec(html)?.[1];
  assert.ok(labelTarget);
  assert.ok(html.includes(`id="${labelTarget}"`));
  assert.ok(html.includes(`aria-describedby="${labelTarget}-help"`));
  assert.match(html, /aria-required="true"/);
  assert.ok(html.includes(`id="${labelTarget}-help"`));
});

test("explicit ids and existing descriptions survive the labelled wrapper", () => {
  const html = renderToStaticMarkup(createElement(EditorField, { label: "Mission", help: "A sentence about your church." }, createElement("textarea", { id: "mission-field", "aria-describedby": "format-note" })));
  assert.match(html, /for="mission-field"/);
  assert.match(html, /aria-describedby="format-note mission-field-help"/);
  assert.match(html, /id="mission-field-help"/);
});

test("new hero buttons store the visible style selection instead of an invalid empty enum", () => {
  const actions = SECTION_REGISTRY.hero.fields?.find(field => field.key === "actions");
  assert.equal(actions?.type, "list");
  if (actions?.type !== "list") return;
  const item = blankSectionItem(actions.itemFields);
  assert.deepEqual(item, { label: "", href: "", variant: "solid" });
});

test("new nested items have proper empty lists, photos, headings, booleans, and numbers", () => {
  const fields: SectionField[] = [
    { key: "photo", label: "Photo", type: "image" },
    { key: "heading", label: "Heading", type: "headline" },
    { key: "enabled", label: "Enabled", type: "toggle" },
    { key: "count", label: "Count", type: "number", min: 1 },
    { key: "body", label: "Body", type: "paragraphs" },
    { key: "group", label: "Group", type: "group", fields: [{ key: "links", label: "Links", type: "list", addLabel: "Add", itemFields: [] }] },
  ];
  assert.deepEqual(blankSectionItem(fields), { photo: { src: null, alt: "" }, heading: { lead: "" }, enabled: false, count: null, body: [], group: { links: [] } });
});

test("moving list items retains unedited fields, image metadata, and object identity", () => {
  const first = { name: "Maya", role: "Pastor", photo: { src: "https://example.test/maya.webp", alt: "Maya" }, hiddenThemeField: "preserved" };
  const second = { name: "Sam", role: "Elder", photo: { src: "https://example.test/sam.webp", alt: "Sam" } };
  const original = [first, second];
  const moved = moveSectionListItem(original, 1, -1);
  assert.deepEqual(moved, [second, first]);
  assert.equal(moved[1], first);
  assert.deepEqual(original, [first, second]);
  assert.equal(moveSectionListItem(original, 0, -1), original);
  assert.equal(moveSectionListItem(original, 1, 1), original);
});

test("emptying a derived list stays intentionally empty until Reset to original", () => {
  const row = { id: "team-section", type: "staff_grid", sortOrder: 1, isVisible: true, props: {} };
  const baseline = resolveSectionBaseline({ row, master: SECTION_REGISTRY.staff_grid, theme: CODE_SITE_THEMES.grace, profile: { ...DEV_PREVIEW_PROFILE, staff: [{ name: "Maya", title: "Pastor", bio: "", photoUrl: null }] }, overrides: [], pageId: "home" });
  assert.equal((baseline.members as unknown[]).length, 1);
  const patch = diffPatch(baseline, { ...baseline, members: [] });
  assert.deepEqual(patch, { members: [] });
  const html = renderToStaticMarkup(createElement(SECTION_REGISTRY.staff_grid.Component, { content: { ...baseline, ...patch }, ctx: { id: row.id, anchor: "team", index: 0 } }));
  assert.equal(html, "");
  // Reset adopts this baseline; it does not invent an "empty means inherit" rule.
  assert.equal((baseline.members as unknown[]).length, 1);
});

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
function renderDashboard(node: React.ReactNode): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, node));
}

test("church details and repeated service/staff controls have accessible names", () => {
  const initial = { name: "Local Church", denomination: "", logoUrl: "", coverImageUrl: "", address: "", city: "", state: "", zip: "", phone: "", email: "", googleMapsUrl: "", missionStatement: "", visionStatement: "", serviceTimes: [{ clientId: "sunday", label: "Sunday worship", dayOfWeek: 0, startTime: "10:00" }], staff: [{ clientId: "maya", fullName: "Maya", title: "Pastor", bio: "", photoUrl: "", isPublic: true }] };
  const html = renderDashboard(createElement(DetailsForm, { initial, recoveryScope: { userId: "pastor", churchId: "church" }, canEdit: true, previewUrl: "/sites/local?preview=1", isLive: false }));
  const controls = [...html.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)].map(match => match[0]).filter(tag => !tag.includes('aria-hidden="true"'));
  assert.ok(controls.length > 15);
  for (const control of controls) {
    if (/aria-label="[^"]+"/.test(control)) continue;
    const id = /\bid="([^"]+)"/.exec(control)?.[1];
    assert.ok(id, `Control lacks id/name: ${control}`);
    assert.ok(html.includes(`for="${id}"`), `Control lacks a connected label: ${control}`);
  }
  assert.match(html, /aria-label="Show Maya on the website"/);
});

test("design swatches use selected database theme defaults and colours can be inherited again", () => {
  const html = renderDashboard(createElement(DesignForm, { themes: [{ key: "grace", name: "Grace", description: null, tokens: { "--site-canvas": "#F1F2F3" } }], initialThemeKey: "grace", initialTokens: {}, initialCustomCss: "", themeDefaults: { "--site-canvas": "#000000" }, recoveryScope: { userId: "pastor", churchId: "church" }, canEdit: true, isPlatformAdmin: false, isLive: false }));
  assert.match(html, /value="#F1F2F3"/);
  const tokens = { "--site-canvas": "#ABCDEF", "--site-accent": "#123456", "--site-font-display": "custom-font" };
  assert.deepEqual(clearBrandToken(tokens, "--site-canvas"), { "--site-accent": "#123456", "--site-font-display": "custom-font" });
  assert.equal(tokens["--site-canvas"], "#ABCDEF");
});

test("publish and domain navigation use a single keyboard target per link", () => {
  const published = renderDashboard(createElement(PublishCard, { initialPublished: true, previewUrl: "/sites/local?preview=1", liveUrl: "https://local.example.test", canEdit: true }));
  const domains = renderDashboard(createElement(DomainWorkspace, { domains: [], openRequest: null, history: [], faithformAddress: "local.faithform.io", previewUrl: "/sites/local?preview=1", canEdit: true, churchName: "Local Church", defaults: { contactName: null, contactEmail: null }, automated: false }));
  for (const html of [published, domains]) {
    const anchors = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)];
    assert.ok(anchors.length > 0);
    for (const anchor of anchors) assert.doesNotMatch(anchor[1], /<(?:button|input|select)\b/);
  }
});

test("a failed inbox update preserves another message's successful Undo", () => {
  const afterUndo = [{ id: "first", status: "new", message: "Kept message" }, { id: "second", status: "read", message: "Other message" }];
  const rolledBack = rollbackInboxStatus(afterUndo, "second", "read", "archived");
  assert.deepEqual(rolledBack, [{ id: "first", status: "new", message: "Kept message" }, { id: "second", status: "archived", message: "Other message" }]);
  assert.equal(rolledBack[0], afterUndo[0]);
  const newerStatus = [{ id: "second", status: "new" }];
  assert.deepEqual(rollbackInboxStatus(newerStatus, "second", "read", "archived"), newerStatus);
});

test("sermons on an offline website say ready to publish rather than claiming they are public",()=>{
  const item={id:"sermon",title:"Our Sunday message",series:null,speaker:null,publishedAt:null,videoUrl:null,thumbnailUrl:null,isPublished:true,sortOrder:0};
  const html=renderDashboard(createElement(MediaTable,{items:[item],canEdit:true,isLive:false,recoveryScope:{userId:"pastor",churchId:"church"}}));
  assert.match(html,/Ready to publish/);
  assert.doesNotMatch(html,/>On your website</);
});
