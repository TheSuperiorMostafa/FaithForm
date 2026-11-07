import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";

test("the downloadable helper includes current source and installs without a repository checkout", async () => {
  const zip = await JSZip.loadAsync(await readFile("public/downloads/faithform-stream-agent.zip"));
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();
  assert.deepEqual(names, ["README.md", "faithform-stream-agent.mjs", "package.json"].map(name => `faithform-stream-agent/${name}`));
  for (const name of ["package.json", "faithform-stream-agent.mjs", "README.md"]) {
    assert.equal(await zip.file(`faithform-stream-agent/${name}`)!.async("string"), await readFile(`infra/stream-agent/${name}`, "utf8"));
  }
  const pkg = JSON.parse(await zip.file("faithform-stream-agent/package.json")!.async("string"));
  assert.equal(pkg.scripts.start, "node faithform-stream-agent.mjs");
  assert.ok(pkg.dependencies["obs-websocket-js"]);
  const card = await readFile("components/live-streaming/encoder-pairing-card.tsx", "utf8");
  assert.match(card, /\/downloads\/faithform-stream-agent\.zip/);
  assert.ok(card.includes('cd "$HOME/Downloads/faithform-stream-agent" &&'));
  assert.doesNotMatch(card, /cd infra\/stream-agent/);
});
