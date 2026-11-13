import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inboxRefreshNeedsCursorReset, mergeInboxMessages, rollbackInboxStatus } from "../../components/website-admin/inbox-state";
import { SubmissionsInbox } from "../../components/website-admin/submissions-inbox";
import type { ContactSubmissionRow } from "../../lib/sites/queries";

Object.assign(globalThis, { React });
const row = (id: string, createdAt: string, status: ContactSubmissionRow["status"] = "new"): ContactSubmissionRow => ({ id, createdAt, status, name: `Visitor ${id}`, email: "visitor@example.test", phone: null, message: "A safe local message", emailedAt: null });

const newest = row("4", "2026-11-12T12:00:00Z");
const recent = row("3", "2026-11-11T12:00:00Z");
const older = row("2", "2026-11-10T12:00:00Z", "archived");
const oldest = row("1", "2026-11-09T12:00:00Z");

test("a refreshed first page preserves loaded older pages while updating recent data", () => {
  const loaded = [recent, older, oldest];
  const refreshed = mergeInboxMessages(loaded, [newest, { ...recent, name: "Updated name", status: "read" }], "refresh");
  assert.deepEqual(refreshed.map(message => message.id), ["4", "3", "2", "1"]);
  assert.equal(refreshed[1].name, "Updated name");
  assert.equal(refreshed[1].status, "read");
  assert.equal(refreshed[2], older);
  assert.equal(refreshed[3], oldest);
});

test("repeated older pages deduplicate and cannot undo a locally triaged message", () => {
  const triaged = { ...older, status: "read" as const };
  const merged = mergeInboxMessages([recent, triaged], [older, oldest, oldest], "older");
  assert.deepEqual(merged.map(message => message.id), ["3", "2", "1"]);
  assert.equal(merged[1], triaged);
  assert.equal(merged[1].status, "read");
});

test("pagination and refresh preserve in-flight status and Undo edits", () => {
  const pending = new Map<string, ContactSubmissionRow["status"]>([[older.id, "new"]]);
  const merged = mergeInboxMessages([recent, older], [{ ...recent, message: "Newer server text" }, older, oldest], "refresh", pending);
  assert.equal(merged.find(message => message.id === older.id)?.status, "new");
  const rolledBack = rollbackInboxStatus(merged, recent.id, "new", "read");
  assert.equal(rolledBack.find(message => message.id === older.id)?.status, "new", "another message's Undo survives a failed operation");
  assert.equal(rolledBack.length, 3);
});

test("merging uses PostgreSQL microsecond precision and the id tie-breaker", () => {
  const sameMillisecond = [row("1", "2026-11-12T12:00:00.123001+00:00"), row("2", "2026-11-12T12:00:00.123999+00:00"), row("3", "2026-11-12T12:00:00.123999+00:00")];
  const merged = mergeInboxMessages([], sameMillisecond, "older");
  assert.deepEqual(merged.map(message => message.id), ["3", "2", "1"]);
});

test("a non-overlapping refreshed first page restarts pagination to fill potential gaps", () => {
  assert.equal(inboxRefreshNeedsCursorReset([older, oldest], [newest, recent]), true);
  assert.equal(inboxRefreshNeedsCursorReset([recent, older, oldest], [newest, recent]), false);
  assert.equal(inboxRefreshNeedsCursorReset([], [newest]), false);
});

test("a filter with no loaded matches still exposes older messages and explains its counts", () => {
  const html = renderToStaticMarkup(createElement(SubmissionsInbox, { items: [older], nextCursor: { createdAt: older.createdAt, id: older.id }, churchName: "Local Church" }));
  assert.match(html, /Show older messages/);
  assert.match(html, /No new messages loaded yet/);
  assert.match(html, /counts above include these messages/);
  assert.doesNotMatch(html, /All 1 messages are loaded/);
});
