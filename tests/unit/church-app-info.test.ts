import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeSocialUrl,
  normalizeWebUrl,
  parseQuickLinks,
  socialLinksFromRow,
} from "@/lib/faithform/church-links";
import { formatServiceTime, nextService } from "@/lib/faithform/next-service";

describe("church links", () => {
  it("turns a handle into the platform's profile URL", () => {
    assert.equal(normalizeSocialUrl("instagram", "@gracechurch"), "https://instagram.com/gracechurch");
    assert.equal(normalizeSocialUrl("youtube", "gracechurch"), "https://youtube.com/@gracechurch");
    assert.equal(normalizeSocialUrl("tiktok", "@grace.church"), "https://tiktok.com/@grace.church");
  });

  it("keeps a pasted link, adding https to a bare domain", () => {
    assert.equal(
      normalizeSocialUrl("facebook", "facebook.com/GraceChurch"),
      "https://facebook.com/GraceChurch",
    );
    assert.equal(
      normalizeSocialUrl("x", "https://x.com/grace"),
      "https://x.com/grace",
    );
  });

  it("refuses anything a phone should not open", () => {
    assert.equal(normalizeWebUrl("javascript:alert(1)"), null);
    assert.equal(normalizeWebUrl("tel:5551234"), null);
    assert.equal(normalizeWebUrl("ftp://grace.church"), null);
    assert.equal(normalizeWebUrl("not a url"), null);
    assert.equal(normalizeSocialUrl("instagram", "has spaces in it"), null);
  });

  it("requires a full link for a podcast", () => {
    assert.equal(normalizeSocialUrl("podcast", "@gracepodcast"), null);
    assert.equal(
      normalizeSocialUrl("podcast", "podcasts.apple.com/us/podcast/grace/id1"),
      "https://podcasts.apple.com/us/podcast/grace/id1",
    );
  });

  it("reads social columns in display order and drops junk", () => {
    const links = socialLinksFromRow({
      facebook_url: "facebook.com/grace",
      instagram_url: "@grace",
      x_url: "javascript:alert(1)",
      podcast_url: null,
    });
    assert.deepEqual(links, [
      { platform: "instagram", url: "https://instagram.com/grace" },
      { platform: "facebook", url: "https://facebook.com/grace" },
    ]);
  });

  it("parses quick links tolerantly and caps them", () => {
    const raw = [
      { label: "Plan a visit", url: "grace.church/visit" },
      { label: "", url: "https://grace.church" },
      { label: "Bad", url: "javascript:void(0)" },
      "junk",
      ...Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, url: `https://x.org/${i}` })),
    ];
    const links = parseQuickLinks(raw);
    assert.equal(links[0].url, "https://grace.church/visit");
    assert.equal(links.length, 8);
    assert.ok(links.every((link) => link.url.startsWith("https://")));
    assert.deepEqual(parseQuickLinks(null), []);
  });
});

describe("next service", () => {
  const services = [
    { label: "Sunday Worship", dayOfWeek: 0, startTime: "10:30" },
    { label: "Wednesday Night", dayOfWeek: 3, startTime: "19:00:00" },
  ];

  it("finds the next one in the church's zone, not the viewer's", () => {
    // Saturday 23:30 in New York is already Sunday 03:30 UTC.
    const now = new Date("2026-09-20T03:30:00Z");
    const next = nextService(services, "America/New_York", now);
    assert.equal(next?.service.label, "Sunday Worship");
    assert.equal(next?.daysAway, 1);
  });

  it("treats a service that already started today as next week", () => {
    // Sunday 11:00 in New York.
    const now = new Date("2026-09-20T15:00:00Z");
    const next = nextService(services, "America/New_York", now);
    assert.equal(next?.service.label, "Wednesday Night");
    assert.equal(next?.daysAway, 3);
  });

  it("says today for a later service the same day", () => {
    // Sunday 08:00 in New York.
    const now = new Date("2026-09-20T12:00:00Z");
    assert.equal(nextService(services, "America/New_York", now)?.daysAway, 0);
  });

  it("returns null with nothing scheduled, and survives a bad zone", () => {
    assert.equal(nextService([], "America/New_York"), null);
    assert.ok(nextService(services, "Not/AZone", new Date("2026-09-20T12:00:00Z")));
  });

  it("formats a wall-clock time without shifting it", () => {
    assert.equal(formatServiceTime("19:00", "en-US"), "7:00 PM");
    assert.equal(formatServiceTime("09:05:00", "en-US"), "9:05 AM");
  });
});
