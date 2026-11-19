import assert from "node:assert/strict";
import test from "node:test";

import { transcriptFilename, transcriptToText } from "@/components/transcripts/export";
import { canStartTranscript, transcriptStatus } from "@/components/transcripts/status";

test("transcript text has the title, date and one timed line per spoken line", () => {
  const text = transcriptToText({
    title: "Sunday Service",
    dateLabel: "Sun, Nov 15, 2026",
    segments: [
      { start: 0, text: "Good morning, church." },
      { start: 75.6, text: "  Please   turn to John 3.  " },
      { start: 3725, text: "Amen." },
    ],
  });
  assert.equal(
    text,
    ["Sunday Service", "Sun, Nov 15, 2026", "", "[0:00] Good morning, church.", "[1:15] Please turn to John 3.", "[1:02:05] Amen.", ""].join("\n"),
  );
});

test("transcript text skips empty lines and marks the sermon's start and end", () => {
  const text = transcriptToText({
    title: "",
    segments: [
      { start: 10, text: "Welcome." },
      { start: 20, text: "   " },
      { start: 60, text: "Our text today." },
      { start: 120, text: "Let us pray." },
      { start: 200, text: "Announcements." },
    ],
    sermon: { startSec: 60, endSec: 150 },
  });
  assert.deepEqual(text.trimEnd().split("\n"), [
    "Transcript",
    "",
    "[0:10] Welcome.",
    "--- Sermon starts (1:00) ---",
    "[1:00] Our text today.",
    "[2:00] Let us pray.",
    "--- Sermon ends (2:30) ---",
    "[3:20] Announcements.",
  ]);
});

test("a sermon running to the last line is still closed", () => {
  const text = transcriptToText({
    title: "Evening",
    segments: [{ start: 5, text: "Grace and peace." }],
    sermon: { startSec: 0, endSec: 600 },
  });
  assert.deepEqual(text.trimEnd().split("\n"), [
    "Evening",
    "",
    "--- Sermon starts (0:00) ---",
    "[0:05] Grace and peace.",
    "--- Sermon ends (10:00) ---",
  ]);
});

test("transcript file names are safe and readable", () => {
  assert.equal(transcriptFilename("Sunday Service: Hope!"), "sunday-service-hope-transcript.txt");
  assert.equal(transcriptFilename("Café Worship — Week 2"), "cafe-worship-week-2-transcript.txt");
  assert.equal(transcriptFilename("!!!"), "service-transcript.txt");
});

test("transcript status: a running job wins, then a ready transcript, then the video's state", () => {
  const job = (status: "queued" | "running" | "failed" | "cancelled" | "succeeded") => ({ status });
  assert.equal(transcriptStatus({ recordingStatus: "ready", transcriptReady: true, job: job("running") }), "working");
  assert.equal(transcriptStatus({ recordingStatus: "ready", transcriptReady: false, job: job("queued") }), "working");
  assert.equal(transcriptStatus({ recordingStatus: "published", transcriptReady: true, job: job("failed") }), "ready");
  assert.equal(transcriptStatus({ recordingStatus: "processing", transcriptReady: false, job: null }), "preparing");
  assert.equal(transcriptStatus({ recordingStatus: "failed", transcriptReady: false, job: null }), "video_problem");
  assert.equal(transcriptStatus({ recordingStatus: "ready", transcriptReady: false, job: job("failed") }), "failed");
  assert.equal(transcriptStatus({ recordingStatus: "ready", transcriptReady: false, job: job("cancelled") }), "stopped");
  assert.equal(transcriptStatus({ recordingStatus: "ready", transcriptReady: false, job: null }), "none");
  assert.equal(canStartTranscript("none"), true);
  assert.equal(canStartTranscript("failed"), true);
  assert.equal(canStartTranscript("preparing"), false);
  assert.equal(canStartTranscript("ready"), false);
});
