import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Row level security lets only admins write announcements, but the actions
 * checked only the Announcements permission. For a teammate without admin the
 * write silently changed nothing while the app notification, the Facebook post
 * and the calendar change went out anyway — and the screen said it worked. An
 * update that touched no row also let a foreign id reach the push queue.
 */
const source = readFileSync("app/dashboard/announcements/actions.ts", "utf8");

function body(name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\nexport async function ", start + 1));
}

test("publishing, sharing further and deleting are admin-only, checked first", () => {
  for (const name of ["publishAnnouncement", "publishToMoreChannels", "deleteAnnouncement"]) {
    const text = body(name);
    const check = text.indexOf("announcementAdminError()");
    assert.ok(check > 0, `${name} does not check admin`);
    for (const effect of ["applyMobilePublication(", "postEventToFacebook(", "withdrawMobilePublication(", ".delete()"]) {
      const at = text.indexOf(effect);
      if (at >= 0) assert.ok(check < at, `${name}: ${effect} runs before the admin check`);
    }
  }
});

test("an update that changed no row is not a save", () => {
  const publish = body("publishAnnouncement");
  assert.match(publish, /\.eq\("church_id", ctx\.churchId\)\s*\.select\("id"\)/);
  assert.match(publish, /\(updated \?\? \[\]\)\.length === 0/);
});

test("cancelling queued notifications is scoped to the church", () => {
  const outbox = readFileSync("lib/faithform/push/outbox.ts", "utf8");
  const cancel = outbox.slice(outbox.indexOf("export async function cancelNotificationsForSubject"));
  assert.match(cancel.slice(0, cancel.indexOf("\n}\n")), /\.eq\("church_id", churchId\)/);
});
