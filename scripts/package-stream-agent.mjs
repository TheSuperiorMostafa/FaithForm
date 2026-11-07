import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";

const root = resolve(import.meta.dirname, "..");
const zip = new JSZip();
for (const name of ["package.json", "faithform-stream-agent.mjs", "README.md"]) {
  zip.file(`faithform-stream-agent/${name}`, await readFile(resolve(root, "infra/stream-agent", name)), { date: new Date("2026-01-01T00:00:00Z") });
}
const destination = resolve(root, "public/downloads/faithform-stream-agent.zip");
await mkdir(resolve(root, "public/downloads"), { recursive: true });
await writeFile(destination, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("Packaged public/downloads/faithform-stream-agent.zip");
