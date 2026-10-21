import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordingExtraFields, RecordingPrimaryFields } from "@/components/media/recording-details-fields";

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
    speaker: "Pastor John", onSpeakerChange: change, description: "Grace and hope", onDescriptionChange: change,
    chapters: "John 3, Romans 8", onChaptersChange: change, topics: "Grace, Prayer", onTopicsChange: change,
  }));
  for (const field of ["speaker", "description", "chapters", "topics"]) assert.ok(html.includes(`name="${field}"`));
  for (const value of ["Pastor John", "Grace and hope", "John 3, Romans 8", "Grace, Prayer"]) assert.ok(html.includes(value));
});
