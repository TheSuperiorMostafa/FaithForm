import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { MAX_PHOTO_BODY_BYTES, prepareProfilePhoto, readPhotoBody } from "../../lib/faithform/profile-photo";

test("profile photo becomes a 512 square JPEG with metadata removed", async () => {
  const source = await sharp({ create: { width: 800, height: 800, channels: 3, background: "red" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const output = await prepareProfilePhoto(source.toString("base64"));
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
});

test("profile photo rejects forged formats, corrupt data, invalid base64 and non-square crops", async () => {
  const rectangle = await sharp({ create: { width: 100, height: 200, channels: 3, background: "blue" } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "blue" } }).png().toBuffer();
  for (const value of [null, "", "!@#$", "Zm9v", rectangle.toString("base64"), png.toString("base64"), "A".repeat(1_400_004)]) {
    await assert.rejects(() => prepareProfilePhoto(value), { code: "invalid_request" });
  }
});

test("profile photo rejects pixel bombs before decoding", async () => {
  const source = await sharp({ create: { width: 2100, height: 2100, channels: 3, background: "white" } }).jpeg().toBuffer();
  await assert.rejects(() => prepareProfilePhoto(source.toString("base64")), { code: "invalid_request" });
});

test("photo JSON reads explicit removal and rejects malformed data", async () => {
  assert.deepEqual(await readPhotoBody(new Request("http://local", { method: "PUT", body: '{"jpegBase64":null}' })), { jpegBase64: null });
  await assert.rejects(() => readPhotoBody(new Request("http://local", { method: "PUT", body: "{" })), { code: "invalid_request" });
});

test("photo upload enforces streaming byte limit without trusting Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(500_001)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("http://local", { method: "PUT", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(() => readPhotoBody(request), { code: "payload_too_large" });
  assert.equal(cancelled, true);
  await assert.rejects(() => readPhotoBody(new Request("http://local", { method: "PUT", headers: { "content-length": String(MAX_PHOTO_BODY_BYTES + 1) }, body: "{}" })), { code: "payload_too_large" });
});

test("photo contract requires explicit content and rejects identity or URL overrides", async () => {
  const { updateProfilePhotoRequestSchema } = await import("../../lib/mobile/v1/contract");
  assert.equal(updateProfilePhotoRequestSchema.safeParse({ jpegBase64: null }).success, true);
  for (const value of [{}, { avatarUrl: "https://example.test/photo.jpg" }, { jpegBase64: null, userId: "another-account" }]) {
    assert.equal(updateProfilePhotoRequestSchema.safeParse(value).success, false);
  }
});

test("photo mutation rejects unauthenticated uploads before touching storage", async () => {
  const { PUT } = await import("../../app/api/mobile/v1/account/photo/route");
  const response = await PUT(new Request("http://local/api/mobile/v1/account/photo", { method: "PUT", body: '{"jpegBase64":null}' }), { params: Promise.resolve({}) });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "unauthenticated");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});
