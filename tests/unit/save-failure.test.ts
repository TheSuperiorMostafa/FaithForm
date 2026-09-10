import assert from "node:assert/strict";
import test from "node:test";

import {
  describeSaveFailure,
  GIVE_UP_MESSAGE,
} from "@/components/website-admin/save-failure";

test("a dropped request is retried, and no longer promises a retry that needs another edit", () => {
  const failure = describeSaveFailure(new TypeError("Failed to fetch"), true);
  assert.equal(failure.retry, true);
  assert.doesNotMatch(failure.message, /as you keep editing/);
});

test("offline says so, and waits for the connection", () => {
  const failure = describeSaveFailure(new TypeError("Load failed"), false);
  assert.equal(failure.retry, true);
  assert.match(failure.message, /offline/i);
});

test("a stale page after a deploy asks for a reload instead of retrying", () => {
  const error = Object.assign(
    new Error('Server Action "abc123" was not found on the server.'),
    { name: "UnrecognizedActionError" },
  );
  const failure = describeSaveFailure(error, true);
  assert.equal(failure.retry, false);
  assert.match(failure.message, /Reload the page/);
});

test("a redirect means the sign-in is gone", () => {
  const error = Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;push;/login;307;",
  });
  const failure = describeSaveFailure(error, true);
  assert.equal(failure.retry, false);
  assert.match(failure.message, /signed out/);
});

test("giving up tells them what to do next", () => {
  assert.match(GIVE_UP_MESSAGE, /Reload the page/);
});
