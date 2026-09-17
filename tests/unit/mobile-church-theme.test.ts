import assert from "node:assert/strict";
import test from "node:test";
import {
  churchRelationshipSchema,
  updateChurchThemeRequestSchema,
} from "../../lib/mobile/v1/contract";

test("mobile church themes accept complete hex pairs and reject ambiguous colors", () => {
  assert.equal(updateChurchThemeRequestSchema.safeParse({
    primaryColor: "#164E63",
    accentColor: "#22d3ee",
  }).success, true);
  assert.equal(updateChurchThemeRequestSchema.safeParse({
    primaryColor: "blue",
    accentColor: "#22D3EE",
  }).success, false);
});

test("branding authority is additive for released mobile clients", () => {
  const base = {
    churchSlug: "river-church",
    churchName: "River Church",
    logoUrl: null,
    state: "joined",
    joinPolicy: "approval_required",
    joinedAt: null,
    updatedAt: "2026-09-17T12:00:00.000Z",
    canReadPublishedContent: true,
  };
  assert.equal(churchRelationshipSchema.safeParse(base).success, true);
  assert.equal(churchRelationshipSchema.parse({
    ...base,
    canManageBranding: true,
  }).canManageBranding, true);
});
