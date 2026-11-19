import { NO_PEOPLE_RULE, PEOPLE_WORDS } from "@/lib/ai/image/prompt";

/**
 * Pure pieces of the "Create image with AI" chat: request validation and the
 * Gemini contents built from it. No SDK or server imports, so it can be unit
 * tested and shared with the client for its limits.
 *
 * The conversation lives in the browser. Each turn sends the instruction, a
 * short text history, and (when editing) the current image, which comes back
 * from the server as a compressed JPEG so it stays far below the 4MB body cap.
 */

/** Longest single instruction a person can send. */
export const MAX_IMAGE_CHAT_INSTRUCTION_CHARS = 1000;

/** Earlier turns sent as context; older ones are dropped. */
export const MAX_IMAGE_CHAT_HISTORY_TURNS = 8;

/** Longest text kept from any one earlier turn. */
const MAX_HISTORY_TEXT_CHARS = 600;

/**
 * Largest image accepted back for editing, decoded. The server hands out JPEGs
 * of a few hundred KB; this leaves room while keeping the base64 body (4/3 of
 * this) under the 4MB route limit.
 */
export const MAX_IMAGE_CHAT_PREVIOUS_IMAGE_BYTES = 2_500_000;

/** Longest edge of an image returned to the browser. */
export const IMAGE_CHAT_OUTPUT_MAX_EDGE = 1600;

export type ImageChatMimeType = "image/jpeg" | "image/png" | "image/webp";

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type ImageChatTurn = { role: "user" | "model"; text: string };

export type ImageChatEventContext = {
  title?: string;
  when?: string;
  location?: string;
};

export type ImageChatRequest = {
  instruction: string;
  history: ImageChatTurn[];
  previousImage: { mimeType: ImageChatMimeType; data: string } | null;
  event: ImageChatEventContext | null;
};

export type ImageChatParseResult =
  | { ok: true; request: ImageChatRequest }
  | { ok: false; error: string };

/**
 * The standing brief for every turn. Same house rules as the generated event
 * graphics (prompt.ts): designed church communications, never people.
 */
export const IMAGE_CHAT_SYSTEM_INSTRUCTION = [
  "You are a graphic designer for a church's communications team. You create and edit images the church will post for its events: social posts, flyers, and app banners.",
  "STYLE: polished graphic design built around places, objects, light, texture, and iconography. Rich colour, clear focal point, professional finish. Not clip-art, not a generic stock photo.",
  NO_PEOPLE_RULE,
  "If a request asks for people, show the setting and the objects that suggest them instead (an empty room set up for the event, a table laid for a meal, instruments on a stage) and briefly say so.",
  "TEXT: only render words the person explicitly asks for, spelled exactly as written. Keep all text inside the central 80% of the frame. No watermarks, no invented logos, no UI chrome.",
  "When given an existing image with an instruction, EDIT that image: keep its composition, style and content, and change only what was asked.",
  "Always respond with one finished image, plus at most one short sentence describing what you made or changed.",
].join("\n");

function asTrimmedString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/** Rough decoded size of a base64 string, without decoding it. */
export function base64DecodedBytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** Validates an untrusted request body. Messages are written for people. */
export function parseImageChatRequest(body: unknown): ImageChatParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Describe the picture you want." };
  }
  const raw = body as Record<string, unknown>;

  const instructionRaw = typeof raw.instruction === "string" ? raw.instruction.trim() : "";
  if (!instructionRaw) {
    return { ok: false, error: "Describe the picture you want." };
  }
  if (instructionRaw.length > MAX_IMAGE_CHAT_INSTRUCTION_CHARS) {
    return {
      ok: false,
      error: `Keep each message under ${MAX_IMAGE_CHAT_INSTRUCTION_CHARS} characters.`,
    };
  }

  const history: ImageChatTurn[] = [];
  if (Array.isArray(raw.history)) {
    for (const entry of raw.history.slice(-MAX_IMAGE_CHAT_HISTORY_TURNS)) {
      if (!entry || typeof entry !== "object") continue;
      const turn = entry as Record<string, unknown>;
      const role = turn.role === "model" ? "model" : turn.role === "user" ? "user" : null;
      const text = asTrimmedString(turn.text, MAX_HISTORY_TEXT_CHARS);
      if (role && text) history.push({ role, text });
    }
  }

  let previousImage: ImageChatRequest["previousImage"] = null;
  if (raw.previousImage != null) {
    const image = raw.previousImage as Record<string, unknown>;
    const mimeType = typeof image.mimeType === "string" ? image.mimeType : "";
    const data = typeof image.data === "string" ? image.data : "";
    if (!ALLOWED_MIME_TYPES.has(mimeType) || !data || !BASE64_PATTERN.test(data)) {
      return { ok: false, error: "That picture can't be edited. Start a new one." };
    }
    if (base64DecodedBytes(data) > MAX_IMAGE_CHAT_PREVIOUS_IMAGE_BYTES) {
      return { ok: false, error: "That picture is too large to edit. Start a new one." };
    }
    previousImage = { mimeType: mimeType as ImageChatMimeType, data };
  }

  let event: ImageChatEventContext | null = null;
  if (raw.event && typeof raw.event === "object") {
    const e = raw.event as Record<string, unknown>;
    const candidate = {
      title: asTrimmedString(e.title, 200) || undefined,
      when: asTrimmedString(e.when, 120) || undefined,
      location: asTrimmedString(e.location, 200) || undefined,
    };
    if (candidate.title || candidate.when || candidate.location) event = candidate;
  }

  return { ok: true, request: { instruction: instructionRaw, history, previousImage, event } };
}

/** Whether the person's wording asks for people, which the image must not show. */
export function mentionsPeople(text: string): boolean {
  return PEOPLE_WORDS.test(text);
}

function describeEvent(event: ImageChatEventContext | null): string | null {
  if (!event) return null;
  const lines = [
    event.title ? `Title: "${event.title}"` : null,
    event.when ? `When: "${event.when}"` : null,
    event.location ? `Where: "${event.location}"` : null,
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return `EVENT DETAILS (for reference; only put these words in the image if asked, and then copy them exactly): ${lines.join(" · ")}`;
}

/** The text of the final user turn: the instruction plus its framing. */
export function buildImageChatInstruction(request: ImageChatRequest): string {
  const parts = [
    request.previousImage
      ? `Edit the attached image. Instruction: ${request.instruction}`
      : `Create a new image. Description: ${request.instruction}`,
    request.previousImage
      ? null
      : "Default to a 16:9 landscape frame unless the description asks for another shape.",
    describeEvent(request.event),
    mentionsPeople(request.instruction)
      ? "Reminder: no people may appear. Show the place and things instead."
      : null,
  ];
  return parts.filter(Boolean).join("\n");
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
export type ImageChatContent = { role: "user" | "model"; parts: GeminiPart[] };

/**
 * Gemini `contents` for one turn: earlier turns as text, then the current
 * image (when editing) and the framed instruction. Only the latest image is
 * sent; earlier versions would multiply the payload for little benefit.
 *
 * Gemini expects turns to alternate and to start with the user, so the text
 * history is normalised to that shape.
 */
export function buildImageChatContents(request: ImageChatRequest): ImageChatContent[] {
  const contents: ImageChatContent[] = [];
  for (const turn of request.history) {
    const last = contents[contents.length - 1];
    if (!last && turn.role === "model") continue;
    if (last && last.role === turn.role) {
      last.parts.push({ text: turn.text });
      continue;
    }
    contents.push({ role: turn.role, parts: [{ text: turn.text }] });
  }

  const finalParts: GeminiPart[] = [];
  if (request.previousImage) {
    finalParts.push({
      inlineData: { mimeType: request.previousImage.mimeType, data: request.previousImage.data },
    });
  }
  finalParts.push({ text: buildImageChatInstruction(request) });

  const last = contents[contents.length - 1];
  if (last && last.role === "user") {
    // History ended on a user turn (an earlier attempt that failed): fold it in.
    last.parts.push(...finalParts);
  } else {
    contents.push({ role: "user", parts: finalParts });
  }
  return contents;
}
