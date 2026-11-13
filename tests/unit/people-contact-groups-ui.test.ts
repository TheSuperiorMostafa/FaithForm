import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberFormPanel } from "@/components/people/member-form-panel";
import { MemberGroupList } from "@/components/people/member-groups";

Object.assign(globalThis, { React });

test("the real person panel names the existing care tab Notes and reserves a loading state for group memberships", () => {
  const html = renderToStaticMarkup(createElement(MemberFormPanel, {
    member: { id: "12345678-1234-1234-1234-123456789abc", first_name: "Avery", last_name: "Lee", phone: null, email: "avery@example.invalid", photo_url: null, is_active: true, attendance_count: 0 },
    isAdmin: true, onClose() {}, onSaved() {},
  }));
  assert.match(html, />Notes<\/span>/);
  assert.doesNotMatch(html, />Care<\/span>/);
  assert.match(html, /aria-label="Groups"/);
  assert.match(html, /aria-label="Loading groups"/);
  assert.doesNotMatch(html, /Not in any groups yet/);
  assert.match(html, /avery@example.invalid/);
});

test("existing group names and archive status render as reachable group links, with a truthful empty state", () => {
  const groups = [{ id: "22222222-2222-4222-8222-222222222222", name: "Prayer & Fellowship", archived: false }, { id: "33333333-3333-4333-8333-333333333333", name: "Earlier group", archived: true }];
  const before = JSON.stringify(groups);
  const html = renderToStaticMarkup(createElement(MemberGroupList, { groups }));
  assert.match(html, /Prayer &amp; Fellowship/);
  assert.match(html, /href="\/dashboard\/groups\/22222222-2222-4222-8222-222222222222"/);
  assert.match(html, /Earlier group/);
  assert.match(html, />Archived<\/span>/);
  assert.equal(JSON.stringify(groups), before);
  assert.match(renderToStaticMarkup(createElement(MemberGroupList, { groups: [] })), /Not in any groups yet/);
});
