import assert from "node:assert/strict";
import test from "node:test";

import {
  base64DecodedBytes,
  buildImageChatContents,
  buildImageChatInstruction,
  IMAGE_CHAT_EVENT_INSTRUCTION,
  IMAGE_CHAT_SYSTEM_INSTRUCTION,
  MAX_IMAGE_CHAT_HISTORY_TURNS,
  MAX_IMAGE_CHAT_INSTRUCTION_CHARS,
  MAX_IMAGE_CHAT_PREVIOUS_IMAGE_BYTES,
  parseImageChatRequest,
  type ImageChatBrand,
  type ImageChatRequest,
} from "@/lib/ai/image/chat-prompt";
import { NO_PEOPLE_RULE } from "@/lib/ai/image/prompt";

const IMAGE = { mimeType: "image/jpeg", data: Buffer.from("fake-jpeg").toString("base64") };
const LOGO = { mimeType: "image/png", data: Buffer.from("fake-logo").toString("base64") };
const BRAND: ImageChatBrand = {
  churchName: "Grace Fellowship",
  primaryColor: "#002D5F",
  accentColor: "#C5A059",
  logo: LOGO,
};

function parsed(body: unknown): ImageChatRequest {
  const result = parseImageChatRequest(body);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.request;
}

test("system instruction keeps the no-people house rule", () => {
  assert.ok(IMAGE_CHAT_SYSTEM_INSTRUCTION.includes(NO_PEOPLE_RULE));
  assert.match(IMAGE_CHAT_SYSTEM_INSTRUCTION, /designer/i);
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
  assert.match(create, /^Create a new 16:9 landscape graphic/);
  const edit = buildImageChatInstruction(parsed({ instruction: "make it darker", previousImage: IMAGE }));
  assert.match(edit, /^Edit the CURRENT DESIGN/);
  assert.match(edit, /make it darker/);
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
  assert.ok(last.parts.some((part) => "inlineData" in part));
  assert.ok("text" in last.parts[last.parts.length - 1]!);
});

test("a history ending on a user turn is folded into the final turn", () => {
  const contents = buildImageChatContents(
    parsed({ instruction: "try again", history: [{ role: "user", text: "a candle" }] }),
  );
  assert.equal(contents.length, 1);
  assert.equal(contents[0]?.parts.length, 2);
});

test("system instruction puts listening, the frame and the real logo first-class", () => {
  assert.match(IMAGE_CHAT_SYSTEM_INSTRUCTION, /LISTEN FIRST/);
  assert.match(IMAGE_CHAT_SYSTEM_INSTRUCTION, /1200×630/);
  assert.match(IMAGE_CHAT_SYSTEM_INSTRUCTION, /never invent a logo/i);
});

test("event mode needs a title and always starts a fresh design", () => {
  assert.equal(parseImageChatRequest({ mode: "event", event: { when: "Nov 23" } }).ok, false);
  const request = parsed({
    mode: "event",
    instruction: "ignored",
    history: [{ role: "user", text: "old" }],
    previousImage: IMAGE,
    event: { title: "Fall Potluck", when: "Sun, Nov 23 · 5 PM", details: "Bring a dish to share." },
  });
  assert.equal(request.mode, "event");
  assert.equal(request.instruction, IMAGE_CHAT_EVENT_INSTRUCTION);
  assert.deepEqual(request.history, []);
  assert.equal(request.previousImage, null);
  assert.equal(request.event?.details, "Bring a dish to share.");
});

test("event brief prints the title and church name, leaves date and place for the chat, and uses the description for the scene", () => {
  const brief = buildImageChatInstruction(
    parsed({
      mode: "event",
      event: { title: "Fall Potluck", when: "Sun, Nov 23 · 5 PM", location: "Fellowship Hall", details: "Chili cook-off" },
    }),
    BRAND,
  );
  assert.match(brief, /16:9/);
  assert.match(brief, /"Fall Potluck"/);
  assert.match(brief, /"Grace Fellowship"/);
  assert.doesNotMatch(brief, /Sun, Nov 23/);
  assert.doesNotMatch(brief, /Fellowship Hall/);
  assert.match(brief, /Do NOT print the date, time, place/);
  assert.match(brief, /no flat panel/);
  assert.match(brief, /exactly once/);
  assert.match(brief, /do not print it\): Chili cook-off/);
  assert.match(brief, /#002D5F/);
  assert.match(brief, /attached logo/);
});

test("the church logo is attached and labelled before the design being edited", () => {
  const contents = buildImageChatContents(parsed({ instruction: "bigger title", previousImage: IMAGE }), BRAND);
  const parts = contents[contents.length - 1]!.parts;
  const images = parts.filter((part) => "inlineData" in part) as { inlineData: { data: string } }[];
  assert.deepEqual(
    images.map((part) => part.inlineData.data),
    [LOGO.data, IMAGE.data],
  );
  assert.match((parts[0] as { text: string }).text, /CHURCH LOGO/);
  assert.match((parts[2] as { text: string }).text, /CURRENT DESIGN/);
});

test("without a logo, nothing logo-related is sent", () => {
  const contents = buildImageChatContents(parsed({ instruction: "a candle" }), { ...BRAND, logo: null });
  const text = contents
    .flatMap((c) => c.parts)
    .map((part) => ("text" in part ? part.text : ""))
    .join("\n");
  assert.doesNotMatch(text, /LOGO/);
});

test("system instruction asks for designed type, one logo, and edits that really move things", () => {
  assert.match(IMAGE_CHAT_SYSTEM_INSTRUCTION, /Never split the frame into a flat colour block/);
  assert.match(IMAGE_CHAT_SYSTEM_INSTRUCTION, /ONCE/);
  assert.match(IMAGE_CHAT_SYSTEM_INSTRUCTION, /moved text is gone from its old place/);
});

test("a described picture carries the event's title, and the date only when asked", () => {
  const create = buildImageChatInstruction(
    parsed({ instruction: "a cosy reading nook", event: { title: "Bible Study", when: "Wed, Nov 26 · 7 PM" } }),
    BRAND,
  );
  assert.match(create, /unless the description says no text/);
  assert.match(create, /"Bible Study"/);
  assert.match(create, /print these ONLY if the description asks for them.*"Wed, Nov 26 · 7 PM"/);
  assert.doesNotMatch(create, /\d\. .*Wed, Nov 26/);
  assert.match(create, /"Grace Fellowship"/);
  const edit = buildImageChatInstruction(
    parsed({ instruction: "move the title left", previousImage: IMAGE, event: { title: "Bible Study" } }),
    BRAND,
  );
  assert.doesNotMatch(edit, /unless the description says no text/);
});
