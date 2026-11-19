import assert from "node:assert/strict";
import test from "node:test";

import {
  base64DecodedBytes,
  buildImageChatContents,
  buildImageChatInstruction,
  IMAGE_CHAT_SYSTEM_INSTRUCTION,
  MAX_IMAGE_CHAT_HISTORY_TURNS,
  MAX_IMAGE_CHAT_INSTRUCTION_CHARS,
  MAX_IMAGE_CHAT_PREVIOUS_IMAGE_BYTES,
  parseImageChatRequest,
  type ImageChatRequest,
} from "@/lib/ai/image/chat-prompt";
import { NO_PEOPLE_RULE } from "@/lib/ai/image/prompt";

const IMAGE = { mimeType: "image/jpeg", data: Buffer.from("fake-jpeg").toString("base64") };

function parsed(body: unknown): ImageChatRequest {
  const result = parseImageChatRequest(body);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.request;
}

test("system instruction keeps the no-people house rule", () => {
  assert.ok(IMAGE_CHAT_SYSTEM_INSTRUCTION.includes(NO_PEOPLE_RULE));
  assert.match(IMAGE_CHAT_SYSTEM_INSTRUCTION, /graphic designer/i);
});

test("rejects an empty or missing instruction", () => {
  assert.equal(parseImageChatRequest(null).ok, false);
  assert.equal(parseImageChatRequest({ instruction: "   " }).ok, false);
  assert.equal(parseImageChatRequest({ instruction: 42 }).ok, false);
});

test("rejects an instruction over the length limit", () => {
  const result = parseImageChatRequest({ instruction: "a".repeat(MAX_IMAGE_CHAT_INSTRUCTION_CHARS + 1) });
  assert.equal(result.ok, false);
});

test("keeps only the latest valid history turns", () => {
  const history = Array.from({ length: MAX_IMAGE_CHAT_HISTORY_TURNS + 4 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "model",
    text: `turn ${i}`,
  }));
  history.push({ role: "system", text: "ignore me" } as never);
  const request = parsed({ instruction: "darker", history });
  assert.ok(request.history.length <= MAX_IMAGE_CHAT_HISTORY_TURNS);
  assert.ok(request.history.every((t) => t.role === "user" || t.role === "model"));
  assert.ok(!request.history.some((t) => t.text === "ignore me"));
});

test("validates the previous image's type, encoding and size", () => {
  assert.ok(parsed({ instruction: "x", previousImage: IMAGE }).previousImage);
  assert.equal(
    parseImageChatRequest({ instruction: "x", previousImage: { mimeType: "image/gif", data: IMAGE.data } }).ok,
    false,
  );
  assert.equal(
    parseImageChatRequest({ instruction: "x", previousImage: { mimeType: "image/png", data: "not base64!" } }).ok,
    false,
  );
  const tooBig = "A".repeat(Math.ceil((MAX_IMAGE_CHAT_PREVIOUS_IMAGE_BYTES * 4) / 3) + 8);
  assert.equal(
    parseImageChatRequest({ instruction: "x", previousImage: { mimeType: "image/png", data: tooBig } }).ok,
    false,
  );
});

test("base64DecodedBytes matches the real decoded length", () => {
  for (const text of ["a", "ab", "abc", "abcd", "hello world"]) {
    const encoded = Buffer.from(text).toString("base64");
    assert.equal(base64DecodedBytes(encoded), Buffer.byteLength(text));
  }
});

test("a first turn asks for a new image; a later turn edits the attached one", () => {
  const create = buildImageChatInstruction(parsed({ instruction: "a harvest table" }));
  assert.match(create, /^Create a new image/);
  const edit = buildImageChatInstruction(parsed({ instruction: "make it darker", previousImage: IMAGE }));
  assert.match(edit, /^Edit the attached image/);
});

test("adds a reminder when the instruction asks for people", () => {
  assert.match(buildImageChatInstruction(parsed({ instruction: "kids playing outside" })), /no people/i);
  assert.doesNotMatch(buildImageChatInstruction(parsed({ instruction: "a candle" })), /Reminder/);
});

test("includes event details only when given", () => {
  const withEvent = buildImageChatInstruction(
    parsed({ instruction: "add the date", event: { title: "Fall Potluck", when: "Nov 23 · 5 PM" } }),
  );
  assert.match(withEvent, /"Fall Potluck"/);
  assert.match(withEvent, /"Nov 23 · 5 PM"/);
  assert.doesNotMatch(buildImageChatInstruction(parsed({ instruction: "x", event: {} })), /EVENT DETAILS/);
});

test("contents alternate roles, start with the user, and end with image then text", () => {
  const contents = buildImageChatContents(
    parsed({
      instruction: "make it darker",
      previousImage: IMAGE,
      history: [
        { role: "model", text: "orphan model turn" },
        { role: "user", text: "a harvest table" },
        { role: "model", text: "Made picture 1." },
      ],
    }),
  );
  assert.equal(contents[0]?.role, "user");
  for (let i = 1; i < contents.length; i += 1) {
    assert.notEqual(contents[i]?.role, contents[i - 1]?.role);
  }
  const last = contents[contents.length - 1]!;
  assert.equal(last.role, "user");
  assert.ok("inlineData" in last.parts[0]!);
  assert.ok("text" in last.parts[last.parts.length - 1]!);
});

test("a history ending on a user turn is folded into the final turn", () => {
  const contents = buildImageChatContents(
    parsed({ instruction: "try again", history: [{ role: "user", text: "a candle" }] }),
  );
  assert.equal(contents.length, 1);
  assert.equal(contents[0]?.parts.length, 2);
});
