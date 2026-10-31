import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureCaptionDetails,
  eventSeason,
  formatCaptionWhen,
  formatChurchAddress,
  isChurchLocation,
  resolveEventLocation,
  shortLocation,
} from "@/lib/social/event-details";

const grace = {
  name: "Grace Community Church of the Nazarene",
  address: "4308 Taylorsville Rd",
  city: "Louisville",
  state: "KY",
  zip: "40220",
};

test("the church's address is built from what it saved", () => {
  assert.equal(formatChurchAddress(grace), "4308 Taylorsville Rd, Louisville, KY 40220");
  assert.equal(formatChurchAddress({ name: "X" }), "");
});

test("a calendar string for the church's own street is recognised as the church", () => {
  assert.ok(isChurchLocation("4308 Taylorsville Rd, Louisville, KY 40220, USA", grace));
  assert.ok(isChurchLocation("4308 Taylorsville Road", grace));
  assert.ok(isChurchLocation("Grace Community Church of the Nazarene", grace));
  assert.ok(!isChurchLocation("3965 Taylorsville Rd, Louisville, KY", grace));
  assert.ok(!isChurchLocation("Heine Brothers Coffee", grace));
});

test("at the church, the flyer prints the saved street, not the calendar's", () => {
  const place = resolveEventLocation("4308 Taylorsvile Road, Louisville, KY 40220, USA", grace);
  assert.equal(place.atChurch, true);
  assert.equal(place.flyerLine, "4308 Taylorsville Rd");
  assert.equal(place.full, "4308 Taylorsville Rd, Louisville, KY 40220");
});

test("an outside venue prints its name only", () => {
  const place = resolveEventLocation(
    "Heine Brothers Coffee - Hikes Point, 3965 Taylorsville Rd, Louisville, KY 40220, USA",
    grace,
  );
  assert.equal(place.atChurch, false);
  assert.equal(place.flyerLine, "Heine Brothers Coffee - Hikes Point");
  assert.equal(
    place.full,
    "Heine Brothers Coffee - Hikes Point, 3965 Taylorsville Rd, Louisville, KY 40220",
  );
});

test("no location typed: nothing printed on the image, church address assumed for the writer", () => {
  const place = resolveEventLocation("", grace);
  assert.equal(place.flyerLine, null);
  assert.equal(place.assumed, true);
  assert.equal(place.full, "4308 Taylorsville Rd, Louisville, KY 40220");
});

test("a short location is never the city, state or zip", () => {
  assert.equal(shortLocation("The Loft, 12 Main St, Louisville, KY"), "The Loft");
  assert.equal(shortLocation("12 Main St, Louisville, KY"), "12 Main St");
});

test("the caption date is in the church's zone, with a time range", () => {
  assert.equal(
    formatCaptionWhen("2026-10-30T22:30:00Z", "2026-10-31T00:00:00Z", "America/New_York"),
    "Friday, October 30 · 6:30 PM – 8:00 PM",
  );
  assert.equal(
    formatCaptionWhen("2026-10-31T01:00:00Z", null, "America/New_York"),
    "Friday, October 30 · 9:00 PM",
  );
  assert.equal(
    formatCaptionWhen("2026-11-07", null, "America/New_York", true),
    "Saturday, November 7 · all day",
  );
});

test("a caption missing the date or place gets them appended", () => {
  const fixed = ensureCaptionDetails("Come grow with us in God's Word! #BibleStudy", {
    when: "Thursday, October 29 · 6:30 PM – 8:00 PM",
    location: "4308 Taylorsville Rd, Louisville, KY 40220",
  });
  assert.match(fixed, /📅 Thursday, October 29 · 6:30 PM – 8:00 PM/);
  assert.match(fixed, /📍 4308 Taylorsville Rd, Louisville, KY 40220/);
});

test("a caption that already has the date and place is left alone", () => {
  const caption =
    "Come grow with us!\n📅 Thursday, October 29 · 6:30 PM – 8:00 PM\n📍 4308 Taylorsville Rd, Louisville, KY 40220";
  assert.equal(
    ensureCaptionDetails(caption, {
      when: "Thursday, October 29 · 6:30 PM – 8:00 PM",
      location: "4308 Taylorsville Rd, Louisville, KY 40220",
    }),
    caption,
  );
});

test("an assumed place is never appended", () => {
  const caption = "See you Thursday, October 29 at the church!";
  assert.equal(
    ensureCaptionDetails(caption, { when: "Thursday, October 29 · 6:30 PM", location: null }),
    caption,
  );
});

test("season follows the event date in the church's zone", () => {
  assert.equal(eventSeason("2026-10-30T22:30:00Z", "America/New_York"), "autumn");
  assert.equal(eventSeason("2026-12-01T03:00:00Z", "America/New_York"), "autumn");
  assert.equal(eventSeason("2026-12-24T22:00:00Z", "America/New_York"), "winter");
  assert.equal(eventSeason(undefined, "America/New_York"), null);
});
