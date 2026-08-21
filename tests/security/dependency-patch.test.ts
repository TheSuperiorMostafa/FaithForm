import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("image-size denial-of-service patch rejects non-progressing boxes", () => {
  const patch = readFileSync("patches/image-size@1.2.1.patch", "utf8");
  assert.match(patch, /boxSize < 8/);
  assert.match(patch, /imageHeader\[1\] < SIZE_HEADER/);

  const installedPackage = realpathSync(
    "node_modules/.pnpm/pptxgenjs@3.12.0/node_modules/image-size",
  );
  const installedUtils = readFileSync(
    join(installedPackage, "dist/types/utils.js"),
    "utf8",
  );
  assert.match(installedUtils, /boxSize < 8/);
});
