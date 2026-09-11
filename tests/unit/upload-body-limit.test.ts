import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../../next.config.mjs";
import { MAX_ATTACHMENT_BYTES } from "@/lib/announcements/attachments";
import { MAX_MEMBER_FILE_BYTES } from "@/lib/checkin/member-files";
import { UPLOAD_BUDGET_BYTES } from "@/lib/sites/downscale-image";

/**
 * Uploads travel as Server Action bodies, and Next caps that body at 1MB
 * unless told otherwise. Every photo a phone takes is larger than that, so the
 * default turned "change the banner photo" into a raw 413 from the framework:
 * thrown before the action ran, so neither the size check nor the friendly
 * message in uploadSiteImage ever got a say.
 *
 * These lock the two halves of the arrangement together. Delete the config and
 * the ceiling silently drops back to 1MB; raise the client budget past it and
 * the same failure returns from the other side.
 */

const MB = 1024 * 1024;

function limitBytes(): number {
  const raw = nextConfig.experimental?.serverActions?.bodySizeLimit;
  assert.equal(typeof raw, "string", "serverActions.bodySizeLimit must be set");

  const match = /^(\d+(?:\.\d+)?)mb$/i.exec(raw as string);
  assert.ok(match, `expected a value like "4mb", got ${String(raw)}`);
  return Number(match[1]) * MB;
}

test("server actions accept bodies larger than Next's 1MB default", () => {
  assert.ok(
    limitBytes() > MB,
    "the default is what broke banner uploads; the config has to beat it",
  );
});

test("the limit stays inside what Vercel will deliver", () => {
  // Vercel refuses a serverless request body over 4.5MB whatever Next accepts,
  // so a larger number here would only move the failure downstream.
  assert.ok(limitBytes() <= 4.5 * MB);
});

test("the browser never builds a file the server will refuse", () => {
  assert.ok(
    UPLOAD_BUDGET_BYTES < limitBytes(),
    "downscaled uploads must leave room for multipart and crop fields",
  );
});

test("no upload promises more than a Server Action body can carry", () => {
  // Each of these travels as an action body. A limit above the ceiling is a
  // promise the framework breaks on the church's behalf, with a raw error in
  // place of the message the action would have written.
  assert.ok(MAX_ATTACHMENT_BYTES <= limitBytes(), "weekly email attachments");
  assert.ok(MAX_MEMBER_FILE_BYTES <= limitBytes(), "member documents");
});
