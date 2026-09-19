import assert from "node:assert/strict";
import test from "node:test";

import { presentationDetailEtag, sermonArchiveEtag, sermonDetailEtag } from "@/lib/sermons/v1/etag";
import { __testing } from "@/lib/sermons/v1/sermon-service";
import type {
  SermonDetailDto,
  SermonListItemDto,
} from "@/lib/sermons/v1/sermon-service";

/**
 * A shared sermon is read live: fixing a typo in a discussion question, the
 * outline or the title changes what the app shows without bumping
 * `mobile_publication_version`. The old validators hashed ids and versions (and
 * only the *count* of questions), so a phone revalidating its cache was told
 * "not modified" and kept the stale copy. These pin that an edit to anything
 * shown changes the tag, and that an unchanged payload keeps it.
 */

const item: SermonListItemDto = {
  sermonId: "22222222-2222-4222-8222-222222222222",
  title: "The Prodigal Son",
  summary: "On coming home.",
  publishedAt: "2026-09-07T15:00:00.000Z",
  preachedOn: "2026-09-06",
  scriptureRefs: ["Luke 15:11-32"],
  seriesName: "Parables",
  publicationVersion: 2,
  churchSlug: "grace",
  churchName: "Grace Church",
  churchTimezone: "America/New_York",
};

const detail: SermonDetailDto = {
  ...item,
  outline: {
    intro: "We begin with a question.",
    points: [{ title: "Grace finds us", summary: "Luke 15", scripture: null }],
    application: "Go and do likewise.",
    closing: "Amen.",
  },
  discussionQuestions: [
    { category: "warmup", question: "When did you last come home?" },
  ],
};

const archive = (items: SermonListItemDto[]) =>
  sermonArchiveEtag({
    items,
    nextCursor: null,
    sermonVersion: 2,
    cursor: "",
    query: "",
    scope: "member",
  });

test("the detail tag is stable for an unchanged sermon", () => {
  assert.equal(sermonDetailEtag(detail, "member"), sermonDetailEtag(structuredClone(detail), "member"));
});

test("editing a discussion question's text changes the detail tag, at the same count and version", () => {
  const edited: SermonDetailDto = {
    ...detail,
    discussionQuestions: [
      { category: "warmup", question: "When did you last come home to someone?" },
    ],
  };
  assert.equal(edited.discussionQuestions.length, detail.discussionQuestions.length);
  assert.equal(edited.publicationVersion, detail.publicationVersion);
  assert.notEqual(sermonDetailEtag(edited, "member"), sermonDetailEtag(detail, "member"));
});

test("editing the outline, title or scripture changes the detail tag", () => {
  const base = sermonDetailEtag(detail, "member");
  const variants: SermonDetailDto[] = [
    { ...detail, title: "The Lost Son" },
    { ...detail, scriptureRefs: ["Luke 15:1-32"] },
    { ...detail, outline: { ...detail.outline!, closing: "Amen and amen." } },
    { ...detail, seriesName: "Stories Jesus Told" },
  ];
  for (const variant of variants) {
    assert.notEqual(sermonDetailEtag(variant, "member"), base);
  }
});

test("editing a list item's title or date changes the archive tag at the same version", () => {
  const base = archive([item]);
  assert.equal(archive([{ ...item }]), base);
  assert.notEqual(archive([{ ...item, title: "The Lost Son" }]), base);
  assert.notEqual(archive([{ ...item, preachedOn: "2026-08-30" }]), base);
  assert.notEqual(archive([{ ...item, summary: null }]), base);
});

test("each page and each audience has its own archive tag", () => {
  const first = archive([item]);
  const second = sermonArchiveEtag({
    items: [item],
    nextCursor: null,
    sermonVersion: 2,
    cursor: "abc",
    query: "",
    scope: "member",
  });
  const anonymous = sermonArchiveEtag({
    items: [item],
    nextCursor: null,
    sermonVersion: 2,
    cursor: "",
    query: "",
    scope: "anonymous",
  });
  assert.notEqual(first, second);
  assert.notEqual(first, anonymous);
});

test("publishedAt reaches a phone as a UTC instant ending in Z", () => {
  const { utcInstant } = __testing;
  assert.equal(utcInstant("2026-09-13T14:03:22.123456+00:00"), "2026-09-13T14:03:22.123Z");
  assert.equal(utcInstant("2026-09-13T10:03:22-04:00"), "2026-09-13T14:03:22.000Z");
  assert.equal(utcInstant("2026-09-13T14:03:22Z"), "2026-09-13T14:03:22.000Z");
});


test("linked service changes invalidate cached notes and immutable slide decks", () => {
  const live = { mediaId: "event1", kind: "live" as const, title: "Sunday", startsAt: "2026-09-20T14:00:00Z", posterUrl: null };
  const recording = { ...live, mediaId: "recording1", kind: "recording" as const };
  const deck = {
    presentationId: "presentation1", sermonId: detail.sermonId, title: detail.title,
    version: 1, contentHash: "same-slides", publishedAt: detail.publishedAt,
    pageCount: 0, pages: [], scriptureRefs: [], seriesName: null, theme: null,
    renditions: { slides: [] }, churchSlug: detail.churchSlug,
    churchName: detail.churchName, churchTimezone: detail.churchTimezone,
  };
  const states = [[], [live], [recording]];
  assert.equal(new Set(states.map(linkedServices => presentationDetailEtag({ ...deck, linkedServices }, "member"))).size, 3);
  assert.equal(new Set(states.map(linkedServices => sermonDetailEtag({ ...detail, linkedServices }, "member"))).size, 3);
});
