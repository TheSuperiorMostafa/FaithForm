import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  imageTextShadow,
  toThemeBackgroundImage,
} from "@/lib/sermon-builder/pptx-media";
import type { SlideTheme } from "@/lib/sermon-builder/slide-theme-shared";

const photoTheme: SlideTheme = {
  id: "pexels-test",
  name: "Test Photo",
  description: "",
  category: "nature",
  tags: [],
  seasonalTags: [],
  symbolTags: [],
  visualStyle: ["photographic"],
  backgroundType: "image",
  imageUrl: "https://example.com/bg.jpg",
  bg: "0E1428",
  bgCss: "#0E1428",
  text: "F8FAFC",
  accent: "C9A227",
  fontHead: "Georgia",
  fontBody: "Georgia",
  italicRef: false,
  textShadow: true,
  featured: false,
  sortOrder: 100,
};

function makeImage(format: "jpeg" | "png" | "webp"): Promise<Buffer> {
  const base = sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 20, g: 40, b: 90 },
    },
  });
  if (format === "jpeg") return base.jpeg().toBuffer();
  if (format === "png") return base.png().toBuffer();
  return base.webp().toBuffer();
}

test("a JPEG theme photo is packaged under a .jpeg name", async () => {
  const image = await toThemeBackgroundImage(await makeImage("jpeg"));
  assert.ok(image);
  assert.equal(image.path, "theme-background.jpeg");
  assert.ok(image.data.startsWith("data:image/jpeg;base64,"));
});

test("a PNG theme photo is packaged under a .png name", async () => {
  const image = await toThemeBackgroundImage(await makeImage("png"));
  assert.ok(image);
  assert.equal(image.path, "theme-background.png");
  assert.ok(image.data.startsWith("data:image/png;base64,"));
});

test("a WebP upload is re-encoded to JPEG — PowerPoint has no content type for WebP", async () => {
  const image = await toThemeBackgroundImage(await makeImage("webp"));
  assert.ok(image);
  assert.equal(image.path, "theme-background.jpeg");
  const bytes = Buffer.from(image.data.split(",")[1]!, "base64");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

test("bytes that are not an image fall back to no background at all", async () => {
  const image = await toThemeBackgroundImage(
    Buffer.from("<html>storage error page</html>"),
  );
  assert.equal(image, null);
});

test("every text box gets its own shadow object", () => {
  // pptxgenjs converts shadow values to EMU in place on first use; a shared
  // object gets multiplied again on every use until PowerPoint reports the
  // deck as damaged. The guard is that each call returns a fresh object.
  const first = imageTextShadow(photoTheme);
  const second = imageTextShadow(photoTheme);
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});

test("solid themes and photos without the shadow flag draw no shadow", () => {
  assert.equal(
    imageTextShadow({ ...photoTheme, backgroundType: "solid" }),
    undefined,
  );
  assert.equal(imageTextShadow({ ...photoTheme, textShadow: false }), undefined);
});
