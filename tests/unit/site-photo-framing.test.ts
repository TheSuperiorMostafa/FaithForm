import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { normalizeSiteImage } from "@/lib/security/validate-image";
import { getAspect } from "@/lib/sites/image-aspects";

test("Light background uploads preserve a full widescreen photo instead of a banner sliver", async () => {
  const source = await sharp({
    create: { width: 2400, height: 1800, channels: 3, background: "#375A6E" },
  }).png().toBuffer();
  const image = await normalizeSiteImage(source, {
    crop: { x: 0, y: 225, width: 2400, height: 1350 },
    output: getAspect("background").output,
  });
  assert.ok(image);
  const metadata = await sharp(image.buffer).metadata();
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 900);
});

test("the other themes retain their wide banner upload framing", async () => {
  const source = await sharp({
    create: { width: 2400, height: 1800, channels: 3, background: "#375A6E" },
  }).png().toBuffer();
  const image = await normalizeSiteImage(source, {
    crop: { x: 0, y: 600, width: 2400, height: 413 },
    output: getAspect("banner").output,
  });
  assert.ok(image);
  const metadata = await sharp(image.buffer).metadata();
  assert.equal(metadata.width, 2400);
  assert.equal(metadata.height, 413);
});
