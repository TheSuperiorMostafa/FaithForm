import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PeopleClaimsPanel } from "../../components/people/people-claims-panel";
import type { StaffClaimRow } from "../../lib/faithform/people-claims";

Object.assign(globalThis, { React });
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

test("candidate radios carry the actual People identifier and never preselect an identity", () => {
  const claim: StaffClaimRow = {
    id: "44444444-4444-4444-8444-444444444444", status: "pending", source: "join", claimedName: "Harvey Smith", claimedFirstName: "Harvey", claimedLastName: "Smith", claimedEmail: null, claimedPhone: null, requestedMemberId: null, createdAt: "2026-11-13T00:00:00Z",
    candidates: [{ memberId: "12345678-1234-1234-1234-123456789abc", firstName: "Harvey", lastName: "Smith", matchedOn: ["name"], alreadyLinked: false }],
  };
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(PeopleClaimsPanel, { claims: [claim] })));
  const radio = /<input[^>]*type="radio"[^>]*>/.exec(html)?.[0];
  assert.ok(radio);
  assert.ok(radio.includes(`value="${claim.candidates[0].memberId}"`));
  assert.ok(radio.includes(`name="claim-${claim.id}"`));
  assert.doesNotMatch(radio, /checked/);
  assert.match(html, /Choose a person above/);
});
