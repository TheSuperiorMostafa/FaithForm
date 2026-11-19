import assert from "node:assert/strict";
import test from "node:test";
import {
  isPubliclyLive,
  liveBannerHeadline,
  parseSiteLiveStatus,
  siteHomeHref,
  siteLiveHref,
  siteLivePollDelay,
  siteLiveStatusUrl,
  SITE_LIVE_POLL_HIDDEN_MS,
  SITE_LIVE_POLL_VISIBLE_MS,
} from "@/lib/sites/live-banner";

const onAir = { sessionStatus: "live", ingestStartedAt: "2026-11-19T10:00:00Z", previewIngestActive: false, hasPublicEvent: true };

test("a session receiving video for a public event is live", () => {
  assert.equal(isPubliclyLive(onAir), true);
  for (const sessionStatus of ["preparing", "waiting_for_encoder"]) {
    assert.equal(isPubliclyLive({ ...onAir, sessionStatus }), true);
  }
  assert.equal(isPubliclyLive({ ...onAir, ingestStartedAt: null, previewIngestActive: true }), true);
});

test("no banner without ingest, an active session, or a public event", () => {
  assert.equal(isPubliclyLive({ ...onAir, ingestStartedAt: null }), false);
  assert.equal(isPubliclyLive({ ...onAir, sessionStatus: "ended" }), false);
  assert.equal(isPubliclyLive({ ...onAir, sessionStatus: null }), false);
  // A private (non-public) broadcast must not be advertised on the website.
  assert.equal(isPubliclyLive({ ...onAir, hasPublicEvent: false }), false);
});

test("watch and home links work on the app host, custom domains and preview", () => {
  assert.equal(siteLiveHref("/sites/grace", false), "/sites/grace/live");
  assert.equal(siteLiveHref("", false), "/live");
  assert.equal(siteLiveHref("", true), "/live?preview=1");
  assert.equal(siteHomeHref("", false), "/");
  assert.equal(siteHomeHref("/sites/grace", true), "/sites/grace?preview=1");
  assert.equal(siteLiveStatusUrl("grace church"), "/api/sites/live-status?slug=grace%20church");
});

test("polling is slow, idles when hidden and backs off on failure", () => {
  assert.equal(siteLivePollDelay(false, 0), SITE_LIVE_POLL_VISIBLE_MS);
  assert.equal(siteLivePollDelay(true, 0), SITE_LIVE_POLL_HIDDEN_MS);
  assert.equal(siteLivePollDelay(false, 1), SITE_LIVE_POLL_VISIBLE_MS * 2);
  assert.equal(siteLivePollDelay(false, 50), 300_000);
  assert.equal(siteLivePollDelay(false, -3), SITE_LIVE_POLL_VISIBLE_MS);
});

test("status parsing accepts only the public shape", () => {
  assert.deepEqual(parseSiteLiveStatus({ live: true, eventTitle: " Sunday " }), { live: true, eventTitle: "Sunday" });
  assert.deepEqual(parseSiteLiveStatus({ live: false, eventTitle: "Sunday" }), { live: false, eventTitle: null });
  assert.deepEqual(parseSiteLiveStatus({ live: true, eventTitle: 3 }), { live: true, eventTitle: null });
  assert.equal(parseSiteLiveStatus({ live: "yes" }), null);
  assert.equal(parseSiteLiveStatus(null), null);
  assert.equal(parseSiteLiveStatus("live"), null);
});

test("headline names the church", () => {
  assert.equal(liveBannerHeadline("Grace Church"), "Grace Church is now live");
  assert.equal(liveBannerHeadline("  "), "We're live now");
});
