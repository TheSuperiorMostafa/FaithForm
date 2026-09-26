import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Row level security lets only admins write announcements, but the
 * Announcements permission is granted to teammates so they can publish. Their
 * write through their own session silently changed nothing while the app,
 * Facebook and the calendar changed anyway, so the saved row stopped saying
 * what had gone out. After the permission check, the row is now written with a
 * church-scoped service client; an update or delete that touched no row (an id
 * from another church) is not reported as done, and cancelling queued
 * notifications is scoped to the church.
 */
const source = readFileSync("app/dashboard/announcements/actions.ts", "utf8");

function body(name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\nexport async function ", start + 1));
}

test("granted teammates are not turned away by an admin-only gate", () => {
  assert.doesNotMatch(source, /Only a church admin can change announcements/);
});

test("rows are written after the permission check, through the church-scoped writer", () => {
  for (const name of ["publishAnnouncement", "publishToMoreChannels", "deleteAnnouncement"]) {
    const text = body(name);
    const check = text.indexOf('featureActionError("announcements"');
    assert.ok(check > 0, `${name} does not check the Announcements permission`);
    assert.ok(text.indexOf("announcementWriter()") > check, `${name} writes before the check`);
  }
  assert.doesNotMatch(body("deleteAnnouncement"), /ctx\.supabase\s*\.from\("announcements"\)\s*\.delete/);
});

test("a write that changed no row is not a save or a delete", () => {
  const publish = body("publishAnnouncement");
  assert.match(publish, /\.eq\("church_id", ctx\.churchId\)\s*\.select\("id"\)/);
  assert.match(publish, /\(updated \?\? \[\]\)\.length === 0/);
  assert.match(body("deleteAnnouncement"), /\(deleted \?\? \[\]\)\.length === 0/);
});

test("cancelling queued notifications is scoped to the church", () => {
  const outbox = readFileSync("lib/faithform/push/outbox.ts", "utf8");
  const cancel = outbox.slice(outbox.indexOf("export async function cancelNotificationsForSubject"));
  assert.match(cancel.slice(0, cancel.indexOf("\n}\n")), /\.eq\("church_id", churchId\)/);
});
