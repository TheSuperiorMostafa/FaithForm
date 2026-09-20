import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { brandingPhotoRequestSchema, decodeBrandingPhoto, parseImageCrop, saveBrandingImage } from "../../lib/branding/images";
import type { SupabaseClient } from "@supabase/supabase-js";

function store(options: { conflict?: boolean; writeError?: boolean } = {}) {
  const uploads: { path: string; bytes: Buffer }[] = [], deleted: string[][] = [], predicates: unknown[][] = [];
  const storage = {
    upload: async (path: string, bytes: Buffer) => { uploads.push({ path, bytes }); return { error: null }; },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://test.invalid/storage/v1/object/public/branding-images/${path}` } }),
    remove: async (paths: string[]) => { deleted.push(paths); return { error: null }; },
  };
  const query = {
    update: () => query,
    eq: (...args: unknown[]) => { predicates.push(args); return query; },
    neq: (...args: unknown[]) => { predicates.push(args); return query; },
    is: (...args: unknown[]) => { predicates.push(args); return query; },
    select: () => query,
    maybeSingle: async () => ({ data: options.conflict ? null : { id: "group" }, error: options.writeError ? { message: "network" } : null }),
  };
  return { admin: { from: () => query, storage: { from: () => storage } } as unknown as SupabaseClient, uploads, deleted, predicates };
}
const target = { actorUserId: "actor", churchId: "church", groupId: "group", kind: "cover" as const, previousUrl: null };

test("branding contract rejects tenant overrides, omitted content and malformed crops", () => {
  assert.equal(brandingPhotoRequestSchema.safeParse({ imageBase64: null }).success, true);
  for (const body of [{}, { imageBase64: null, churchId: "other" }, { imageBase64: "", url: "evil" }]) assert.equal(brandingPhotoRequestSchema.safeParse(body).success, false);
  assert.throws(() => decodeBrandingPhoto("not base64!"));
  assert.throws(() => parseImageCrop('{"x":-1,"y":0,"width":100,"height":100}'));
});
test("group crop produces a metadata-free square logo and scopes the database write", async () => {
  const fake = store();
  const source = await sharp({ create: { width: 800, height: 800, channels: 3, background: "red" } }).withMetadata().png().toBuffer();
  await saveBrandingImage(fake.admin, target, source, { x: 0, y: 0, width: 800, height: 800 });
  const metadata = await sharp(fake.uploads[0].bytes).metadata();
  // A group photo is a logo: the apps show it square, so it is stored square.
  assert.equal(metadata.width, 1024); assert.equal(metadata.height, 1024); assert.equal(metadata.exif, undefined);
  assert.ok(fake.predicates.some(p => p[0] === "church_id" && p[1] === "church"));
  assert.ok(fake.predicates.some(p => p[0] === "cover_image_url" && p[1] === null));
  assert.match(fake.uploads[0].path, /^church\/groups\/group\/cover-/);
});
test("a competing upload loses safely, while ambiguous writes retain their candidate", async () => {
  const source = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).jpeg().toBuffer();
  const conflict = store({ conflict: true });
  await assert.rejects(saveBrandingImage(conflict.admin, target, source));
  assert.deepEqual(conflict.deleted, [[conflict.uploads[0].path]]);
  const uncertain = store({ writeError: true });
  await assert.rejects(saveBrandingImage(uncertain.admin, target, source));
  assert.equal(uncertain.deleted.length, 0);
});
test("invalid image content is rejected before any storage upload", async () => {
  const fake = store();
  await assert.rejects(saveBrandingImage(fake.admin, target, Buffer.from('<svg onload="alert(1)"></svg>')));
  assert.equal(fake.uploads.length, 0);
});
test("group and church image mutations refuse unauthenticated callers", async () => {
  for (const path of ["../../app/api/mobile/v1/groups/[slug]/[groupId]/photo/route", "../../app/api/mobile/v1/churches/[slug]/branding/route"]) {
    const { PUT } = await import(path);
    const response = await PUT(new Request("http://local/api/mobile/v1/photo", { method: "PUT", body: '{"imageBase64":null}' }), { params: Promise.resolve({ slug: "church", groupId: "group" }) });
    assert.equal(response.status, 401);
  }
});
