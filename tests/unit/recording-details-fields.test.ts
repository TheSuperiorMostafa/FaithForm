import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordingExtraFields, RecordingPrimaryFields } from "@/components/media/recording-details-fields";
import { RecordingVisibilityChoice } from "@/components/media/recording-visibility-choice";
import { createRecordingTagsValue } from "@/components/media/recording-tags-field";

Object.assign(globalThis, { React });
const change = () => {};

test("the shared primary editor retains the saved title and selected series", () => {
  const html = renderToStaticMarkup(createElement(RecordingPrimaryFields, {
    title: "A new beginning", onTitleChange: change, seriesId: "hope", onSeriesChange: change,
    newSeries: "", onNewSeriesChange: change, series: [{ id: "hope", name: "Hope" }], idPrefix: "upcoming",
  }));
  assert.match(html, /value="A new beginning"/);
  assert.match(html, /<option value="hope" selected="">Hope/);
  assert.match(html, /for="upcoming-title"/);
});

test("creating a series uses the same required name field in either editor", () => {
  const html = renderToStaticMarkup(createElement(RecordingPrimaryFields, {
    title: "Sunday", onTitleChange: change, seriesId: "__new__", onSeriesChange: change,
    newSeries: "A living hope", onNewSeriesChange: change, series: [],
  }));
  assert.match(html, /name="new_series_name"/);
  assert.match(html, /value="A living hope"/);
  assert.match(html, /aria-label="New series name"/);
});

test("the shared more-options editor retains every recording detail", () => {
  const html = renderToStaticMarkup(createElement(RecordingExtraFields, {
    speakers: createRecordingTagsValue(["Pastor John", "Doe, Jane"]), onSpeakersChange: change, description: "Grace and hope", onDescriptionChange: change,
    chapters: createRecordingTagsValue(["John 3, Romans 8"]), onChaptersChange: change, topics: createRecordingTagsValue(["Grace", "Prayer"]), onTopicsChange: change,
  }));
  for (const field of ["speakers_json", "description", "chapters_json", "topics_json"]) assert.ok(html.includes(`name="${field}"`));
  for (const value of ["Pastor John", "Doe, Jane", "Grace and hope", "John 3, Romans 8", "Grace", "Prayer"]) assert.ok(html.includes(value));
  assert.match(html, /aria-label="Remove Doe, Jane"/);
  assert.match(html, /press Enter to add/);
});

test("upcoming and recording publication controls visibly retain the saved checked choice", () => {
  const shown = renderToStaticMarkup(createElement(RecordingVisibilityChoice, { checked: true, onChange: change, label: "Show it on your church website", hint: "Anyone can watch." }));
  assert.match(shown, /type="checkbox"[^>]*checked=""/);
  assert.match(shown, /Show it on your church website/);
  const hidden = renderToStaticMarkup(createElement(RecordingVisibilityChoice, { checked: false, onChange: change, label: "Show it in the FaithForm app", disabled: true }));
  assert.doesNotMatch(hidden, /checked=""/);
  assert.match(hidden, /disabled=""/);
});
