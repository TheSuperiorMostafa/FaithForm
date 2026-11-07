import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_RECORDING_UPLOAD_BYTES, recordingUploadPath, validateRecordingUpload } from "@/lib/stream/recording-upload";

const valid = { title: "Sunday service", filename: "sunday.mp4", size: 1024 };
test("recording uploads require a named MP4 with a finite bounded size", () => {
  assert.equal(validateRecordingUpload(valid), null);
  assert.equal(validateRecordingUpload({ ...valid, filename: "Sunday.MP4" }), null);
  for (const patch of [{ title: " " }, { title: "x".repeat(121) }, { filename: "bad.html" }, { filename: "video.mp4.html" }, { size: 0 }, { size: NaN }, { size: Infinity }, { size: 0.5 }, { size: MAX_RECORDING_UPLOAD_BYTES + 1 }]) {
    assert.ok(validateRecordingUpload({ ...valid, ...patch }), JSON.stringify(patch));
  }
});

test("the upload object identity is derived from the authorized church and recording", () => {
  assert.equal(recordingUploadPath("church-a", "recording-a"), "relay/church-a/upload-recording-a.mp4");
  assert.notEqual(recordingUploadPath("church-a", "recording-a"), recordingUploadPath("church-b", "recording-a"));
  assert.notEqual(recordingUploadPath("church-a", "recording-a"), recordingUploadPath("church-a", "recording-b"));
});

test("upload completion checks ownership, object identity and bytes before canonical verification", () => {
  const source = readFileSync("app/dashboard/live-streaming/upload-actions.ts", "utf8");
  assert.match(source, /featureActionError\("live_stream"\)/);
  assert.match(source, /if \(!auth\?\.isAdmin\)/);
  assert.match(source, /createSignedUploadUrl\(path, \{ upsert: false \}\)/);
  const finish = source.slice(source.indexOf("export async function finishRecordingUpload"), source.indexOf("export async function cancelRecordingUpload"));
  assert.match(finish, /await uploadAuth\(\)/);
  assert.match(finish, /\.eq\("church_id", auth.churchId\)\.eq\("storage_path", path\)/);
  assert.match(finish, /Number\(object.size\) !== Number\(row.total_bytes\)/);
  assert.ok(finish.indexOf("Number(object.size)") < finish.indexOf('status: "ready"'));
  assert.match(finish, /await verifyRecording\(\{ recordingId, churchId: auth.churchId, storagePath: path \}, admin\)/);
  assert.doesNotMatch(finish, /publishRecording|mobile_visibility|web_published_at/);
});
