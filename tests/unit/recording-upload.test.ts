import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { describeRecordingUploadError, MAX_RECORDING_UPLOAD_BYTES, recordingUploadPath, validateRecordingUpload } from "@/lib/stream/recording-upload";

const valid = { title: "Sunday service", filename: "sunday.mp4", size: 1024 };
test("recording uploads require a named MP4 with a finite bounded size", () => {
  assert.equal(validateRecordingUpload(valid), null);
  assert.equal(validateRecordingUpload({ ...valid, filename: "Sunday.MP4" }), null);
  for (const patch of [{ title: " " }, { title: "x".repeat(121) }, { filename: "bad.html" }, { filename: "video.mp4.html" }, { size: 0 }, { size: NaN }, { size: Infinity }, { size: 0.5 }, { size: MAX_RECORDING_UPLOAD_BYTES + 1 }]) {
    assert.ok(validateRecordingUpload({ ...valid, ...patch }), JSON.stringify(patch));
  }
});

test("oversized recordings are refused before transfer and storage rejections explain the limit", () => {
  assert.equal(validateRecordingUpload({ ...valid, size: MAX_RECORDING_UPLOAD_BYTES }), null);
  assert.equal(validateRecordingUpload({ ...valid, size: 107_021_468 }), null);
  assert.match(validateRecordingUpload({ ...valid, size: MAX_RECORDING_UPLOAD_BYTES + 1 }) ?? "", /up to 5 GB/);
  assert.match(describeRecordingUploadError({ status: 400, statusCode: "EntityTooLarge" }), /storage limit/);
  assert.match(describeRecordingUploadError({ status: 413 }), /storage limit/);
  assert.match(describeRecordingUploadError({ status: 503 }), /connection/);
});

test("the upload object identity is derived from the authorized church and recording", () => {
  assert.equal(recordingUploadPath("church-a", "recording-a"), "relay/church-a/upload-recording-a.mp4");
  assert.notEqual(recordingUploadPath("church-a", "recording-a"), recordingUploadPath("church-b", "recording-a"));
  assert.notEqual(recordingUploadPath("church-a", "recording-a"), recordingUploadPath("church-a", "recording-b"));
});

test("upload actions authorize admins and pass the authorized church into finalization", () => {
  const source = readFileSync("app/dashboard/live-streaming/upload-actions.ts", "utf8");
  assert.match(source, /featureActionError\("live_stream"\)/);
  assert.match(source, /if \(!auth\?\.isAdmin\)/);
  assert.match(source, /createSignedUploadUrl\(path, \{ upsert: false \}\)/);
  const finish = source.slice(source.indexOf("export async function finishRecordingUpload"), source.indexOf("export async function cancelRecordingUpload"));
  assert.match(finish, /await uploadAuth\(\)/);
  assert.match(finish, /finalizeUploadedRecording\(\{ churchId: auth.churchId, recordingId \}, createAdminClient\(\)\)/);
  assert.doesNotMatch(finish, /publishRecording|mobile_visibility|web_published_at/);
});
