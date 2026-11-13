import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { normalizeSiteImage } from "@/lib/security/validate-image";
import { sectionEditorFields } from "@/lib/sites/editor-fields";
import { getAspect } from "@/lib/sites/image-aspects";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { downscaleForUpload } from "@/lib/sites/downscale-image";

test("the full-height Light welcome photo is not cropped to a narrow banner, and other fields keep their framing", () => {
  const fields = SECTION_REGISTRY.hero.fields!;
  const original = JSON.stringify(fields);
  for (const theme of ["grace", "classic", "wood", "light"]) {
    const image = sectionEditorFields(fields, "hero", theme)!.find(field => field.key === "image");
    assert.ok(image?.type === "image");
    const aspect = getAspect(image.aspect);
    assert.equal(aspect.ratio, theme === "light" ? 16 / 9 : 1280 / 220);
    assert.ok(aspect.output);
    if (theme === "light") assert.ok(aspect.output.height >= 900, "backdrops retain enough source pixels to fill the welcome section");
  }
  assert.equal(JSON.stringify(fields), original, "switching the style must not mutate shared descriptors");
  assert.equal(sectionEditorFields(SECTION_REGISTRY.staff_grid.fields, "staff_grid", "light"), SECTION_REGISTRY.staff_grid.fields);
  assert.equal(sectionEditorFields(undefined, "custom_embed", "light"), null);
});

test("real website photo processing honors backdrop/banner framing and removes camera metadata", async () => {
  const source = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#456789" } }).withMetadata().jpeg().toBuffer();
  for (const key of ["banner", "background"] as const) {
    const aspect = getAspect(key);
    const height = 1600 / aspect.ratio!;
    const normalized = await normalizeSiteImage(source, { crop: { x: 0, y: (1200 - height) / 2, width: 1600, height }, output: aspect.output });
    assert.ok(normalized);
    const image = await sharp(normalized.buffer).metadata();
    assert.equal(image.width, aspect.output!.width);
    assert.equal(image.height, aspect.output!.height);
    assert.equal(image.exif, undefined);
    assert.equal(image.icc, undefined);
  }
});

test("unreadable and executable image payloads are refused before storage", async () => {
  for (const bytes of [Buffer.from("not an image"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]) {
    assert.equal(await normalizeSiteImage(bytes), null);
  }
});

test("transparent WebP photos keep their alpha channel after real server normalization", async () => {
  const source = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 20, g: 40, b: 80, alpha: 0.4 } } }).webp().toBuffer();
  const normalized = await normalizeSiteImage(source);
  assert.ok(normalized);
  assert.equal(normalized.contentType, "image/png");
  const result = await sharp(normalized.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(result.info.channels, 4);
  assert.ok(result.data[3] > 0 && result.data[3] < 255);
});

test("browser preparation preserves transparent logos while keeping opaque phone photos small", async t => {
  const previousDocument = globalThis.document;
  const previousBitmap = globalThis.createImageBitmap;
  t.after(() => {
    if (previousDocument === undefined) delete (globalThis as { document?: Document }).document;
    else globalThis.document = previousDocument;
    if (previousBitmap === undefined) delete (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
    else globalThis.createImageBitmap = previousBitmap;
  });
  let alpha = 255;
  let closed = 0;
  globalThis.createImageBitmap = (async () => ({ width: 4000, height: 2000, close() { closed++; } })) as typeof createImageBitmap;
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([20,40,80,alpha]) }) }),
      toBlob: (done: (blob: Blob) => void, type: string) => done(new Blob(["safe synthetic encoded bytes"], { type })),
    }),
  } as unknown as Document;
  for (const type of ["image/webp", "image/avif"]) {
    alpha = 100;
    const logo = await downscaleForUpload(new File(["synthetic source"], "logo.webp", { type }));
    assert.equal(logo.type, "image/png");
    assert.match(logo.name, /\.png$/);
    alpha = 255;
    const photo = await downscaleForUpload(new File(["synthetic source"], "photo.avif", { type }));
    assert.equal(photo.type, "image/jpeg");
  }
  assert.equal(closed, 4, "decoded images are released after every preparation");
});
