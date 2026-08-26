import assert from "node:assert/strict";
import test from "node:test";

import {
  UNKNOWN_IDENTITY,
  identityMatches,
  responseIdentity,
  strongEtag,
  type ObjectIdentity,
} from "@/lib/media/v1/rendition-check";

/**
 * Binding a verdict to an object rather than to a path.
 *
 * A storage path is mutable: `infra/stream-relay/upload-recording.sh` uploads
 * with `x-upsert: true`, so re-running it replaces the object underneath an
 * unchanged path. Everything here is about the difference between "something is
 * at that path" and "the thing that was verified is at that path".
 */

const verified: ObjectIdentity = {
  etag: '"abc123"',
  versionId: "v1",
  sizeBytes: 4096,
  windowHash: "f".repeat(64),
};

// ---------------------------------------------------------------------------
// Entity tags
// ---------------------------------------------------------------------------

test("a weak validator is not an identity", () => {
  // `W/"abc"` promises *semantic equivalence*, not byte equality — two different
  // encodings of the same sermon may legitimately share one. Accepting it would
  // mean accepting exactly the substitution this mechanism exists to detect.
  assert.equal(strongEtag('W/"abc"'), null);
  assert.equal(strongEtag('w/"abc"'), null);
  assert.equal(strongEtag('  W/"abc"  '), null);
});

test("a strong validator is kept verbatim", () => {
  assert.equal(strongEtag('"abc123"'), '"abc123"');
  assert.equal(strongEtag("  \"abc123\"  "), '"abc123"');
  assert.equal(strongEtag(null), null);
  assert.equal(strongEtag(""), null);
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

test("the same object matches itself", () => {
  assert.equal(identityMatches(verified, { ...verified }), true);
});

test("any disagreeing discriminator is a mismatch", () => {
  for (const field of ["etag", "versionId", "sizeBytes", "windowHash"] as const) {
    const changed = { ...verified, [field]: field === "sizeBytes" ? 4097 : "different" };
    assert.equal(identityMatches(verified, changed), false, field);
  }
});

test("a discriminator only one side knows proves nothing, either way", () => {
  // A provider that stops returning ETags must not silently invalidate a
  // congregation's whole archive — but it must not be able to *authorise*
  // anything either.
  const noEtag = { ...verified, etag: null };
  assert.equal(identityMatches(verified, noEtag), true);
  assert.equal(identityMatches(noEtag, verified), true);

  // Right up until the one field they still share disagrees.
  assert.equal(identityMatches(verified, { ...noEtag, sizeBytes: 1 }), false);
});

test("nothing comparable is not a match", () => {
  // The floor that makes this fail closed. Without it, an identity with no
  // fields would match everything and the check would degrade to "the path is
  // the same" — which is the thing being replaced.
  assert.equal(identityMatches(UNKNOWN_IDENTITY, verified), false);
  assert.equal(identityMatches(verified, UNKNOWN_IDENTITY), false);
  assert.equal(identityMatches(UNKNOWN_IDENTITY, UNKNOWN_IDENTITY), false);
});

test("a window hash alone is not enough to serve bytes with", () => {
  // A live response advertises an ETag, a version or a length — never a hash of
  // a window nobody re-read. So a verdict carrying only a hash would be
  // publishable and then undeliverable, which is worse than refusing it.
  const hashOnly: ObjectIdentity = { etag: null, versionId: null, sizeBytes: null, windowHash: "a".repeat(64) };
  const liveResponse: ObjectIdentity = { etag: '"abc"', versionId: null, sizeBytes: 4096, windowHash: null };
  assert.equal(identityMatches(hashOnly, liveResponse), false);
});

// ---------------------------------------------------------------------------
// Reading a live response
// ---------------------------------------------------------------------------

test("a ranged response reports the whole object's length, not the range's", () => {
  // `Content-Length` on a 206 is the length of the range. The total is only in
  // `Content-Range`, and confusing the two would make every seek look like a
  // different object.
  const identity = responseIdentity(
    new Headers({
      "content-range": "bytes 0-0/9876",
      "content-length": "1",
      etag: '"abc"',
    }),
  );
  assert.equal(identity.sizeBytes, 9876);
  assert.equal(identity.etag, '"abc"');
});

test("an unranged response reports its content length", () => {
  const identity = responseIdentity(new Headers({ "content-length": "4096" }));
  assert.equal(identity.sizeBytes, 4096);
});

test("a weak validator on a live response is dropped, not compared", () => {
  const identity = responseIdentity(new Headers({ etag: 'W/"abc"', "content-length": "4096" }));
  assert.equal(identity.etag, null);
  // And so a weak tag can neither authorise nor invalidate: only the length is
  // left to compare.
  assert.equal(identityMatches({ ...verified, versionId: null, windowHash: null }, identity), true);
  assert.equal(
    identityMatches({ ...verified, versionId: null, windowHash: null }, { ...identity, sizeBytes: 1 }),
    false,
  );
});

test("a version id is read from whichever header the provider uses", () => {
  for (const header of ["x-amz-version-id", "x-version-id", "x-object-version"]) {
    const identity = responseIdentity(new Headers({ [header]: "v9", "content-length": "1" }));
    assert.equal(identity.versionId, "v9", header);
  }
});

test("a response that advertises nothing yields nothing, and therefore matches nothing", () => {
  const identity = responseIdentity(new Headers());
  assert.deepEqual(identity, UNKNOWN_IDENTITY);
  assert.equal(identityMatches(verified, identity), false);
});

// ---------------------------------------------------------------------------
// What the delivery route decides
// ---------------------------------------------------------------------------
//
// The route's check is exactly `identityMatches(grant, responseIdentity(headers))`.
// These drive that composition with the headers a real storage response carries,
// because the route itself needs a network to run and this decision does not.

/** A 206 the way object storage answers a ranged request. */
function rangeResponse(options: { etag?: string; total: number; version?: string }): Headers {
  const headers = new Headers({
    "content-range": `bytes 0-1023/${options.total}`,
    "content-length": "1024",
    "accept-ranges": "bytes",
  });
  if (options.etag) headers.set("etag", options.etag);
  if (options.version) headers.set("x-amz-version-id", options.version);
  return headers;
}

test("a seek into the verified object is served", () => {
  const granted: ObjectIdentity = {
    etag: '"sermon-1"', versionId: null, sizeBytes: 90_000_000, windowHash: "a".repeat(64),
  };
  // Every range request re-checks, so this runs on each scrub. It must not
  // refuse a legitimate seek — the length in `Content-Range` is the whole
  // object's, not the range's.
  assert.equal(
    identityMatches(granted, responseIdentity(rangeResponse({ etag: '"sermon-1"', total: 90_000_000 }))),
    true,
  );
});

test("a replaced object is refused mid-playback, not streamed", () => {
  const granted: ObjectIdentity = {
    etag: '"sermon-1"', versionId: null, sizeBytes: 90_000_000, windowHash: "a".repeat(64),
  };
  // Someone re-ran `upload-recording.sh`. The path is identical and the bytes
  // are not. A route that resolved the path and streamed would serve this.
  assert.equal(
    identityMatches(granted, responseIdentity(rangeResponse({ etag: '"sermon-2"', total: 90_000_000 }))),
    false,
  );
  // And caught by length alone, for a provider that returns no validator.
  assert.equal(
    identityMatches(
      { ...granted, etag: null },
      responseIdentity(rangeResponse({ total: 74_000_000 })),
    ),
    false,
  );
});

test("a provider that answers with nothing serves nothing", () => {
  // Fail closed. A response with no validator, no version and no length is not
  // evidence that this is the right object, so it is not treated as one.
  const granted: ObjectIdentity = {
    etag: '"sermon-1"', versionId: null, sizeBytes: 90_000_000, windowHash: "a".repeat(64),
  };
  assert.equal(identityMatches(granted, responseIdentity(new Headers())), false);
});

test("a version id alone is enough for a provider that versions objects", () => {
  const granted: ObjectIdentity = {
    etag: null, versionId: "v7", sizeBytes: null, windowHash: "a".repeat(64),
  };
  assert.equal(
    identityMatches(granted, responseIdentity(rangeResponse({ total: 1, version: "v7" }))),
    true,
  );
  assert.equal(
    identityMatches(granted, responseIdentity(rangeResponse({ total: 1, version: "v8" }))),
    false,
  );
});
