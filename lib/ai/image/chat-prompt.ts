import { NO_PEOPLE_RULE, PEOPLE_WORDS } from "@/lib/ai/image/prompt";

/**
 * Pure pieces of the "Create image for me" studio: request validation and the
 * Gemini contents built from it. No SDK or server imports, so it can be unit
 * tested and shared with the client for its limits.
 *
 * The conversation lives in the browser. Each turn sends the instruction, a
 * short text history, and (when editing) the current image, which comes back
 * from the server as a compressed JPEG so it stays far below the 4MB body cap.
 * The church's name, colours and logo are added on the server, never trusted
 * from the browser.
 */

/** Longest single instruction a person can send. */
export const MAX_IMAGE_CHAT_INSTRUCTION_CHARS = 1000;

/** Earlier turns sent as context; older ones are dropped. */
export const MAX_IMAGE_CHAT_HISTORY_TURNS = 8;

/** Longest text kept from any one earlier turn. */
const MAX_HISTORY_TEXT_CHARS = 600;

/** Longest event description used to pick the imagery. */
const MAX_EVENT_DETAILS_CHARS = 1200;

/**
 * Largest image accepted back for editing, decoded. The server hands out JPEGs
 * of a few hundred KB; this leaves room while keeping the base64 body (4/3 of
 * this) under the 4MB route limit.
 */
export const MAX_IMAGE_CHAT_PREVIOUS_IMAGE_BYTES = 2_500_000;

/**
 * Every picture is finished at the event graphic's size: the 1200×630 frame
 * Facebook shows and the app poster uses, the same as the flyers made before.
 * Gemini is asked for its nearest frame (16:9) and the result is trimmed to fit,
 * so text and the logo are kept inside the central 80%.
 */
export const IMAGE_CHAT_OUTPUT_WIDTH = 1200;
export const IMAGE_CHAT_OUTPUT_HEIGHT = 630;
export const IMAGE_CHAT_MODEL_ASPECT_RATIO = "16:9";

/** Instruction shown in the thread when a picture is made from the event. */
export const IMAGE_CHAT_EVENT_INSTRUCTION = "Make a picture for this event";

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
  /** What the church wrote about the event; picks the imagery, never printed. */
  details?: string;
};

/**
 * "event": design a finished event graphic from the event's details.
 * "describe": make (or edit) a picture from the person's own words.
 */
export type ImageChatMode = "event" | "describe";

export type ImageChatRequest = {
  mode: ImageChatMode;
  instruction: string;
  history: ImageChatTurn[];
  previousImage: { mimeType: ImageChatMimeType; data: string } | null;
  event: ImageChatEventContext | null;
};

/** The church's own look, loaded on the server for every turn. */
export type ImageChatBrand = {
  churchName: string;
  primaryColor: string;
  accentColor: string;
  /** The real logo as a small PNG, or null when the church has none. */
  logo: { mimeType: string; data: string } | null;
};

export type ImageChatParseResult =
  | { ok: true; request: ImageChatRequest }
  | { ok: false; error: string };

/**
 * The standing brief for every turn. Same house rules as the generated event
 * graphics (prompt.ts): designed church communications, never people. The
 * listening rules come first because a picture that ignores what was asked is
 * the failure people notice most.
 */
export const IMAGE_CHAT_SYSTEM_INSTRUCTION = [
  "You are a senior graphic designer on a church's communications team. You create and edit the graphics the church posts for its events: Facebook posts, app posters and flyers.",
  "LISTEN FIRST: follow the person's words literally and completely. Every subject, colour, style, word, size and placement they ask for must be clearly visible in the result. Never skip part of a request, never swap it for something you think looks better, and never add subjects they did not ask for. If a request is ambiguous, take the most literal reading.",
  "FRAME: every image is one 16:9 landscape graphic that will be shown at 1200×630. Keep all text and the logo inside the central 80% of the frame so nothing is lost when the edges are trimmed.",
  "STYLE: modern, polished graphic design: a striking hero image of places, objects, light and texture, rich colour, a clear focal point and confident typography. Not clip-art, not a generic stock photo with words pasted on.",
  NO_PEOPLE_RULE,
  "If a request asks for people, show the setting and the objects that suggest them instead (an empty room set up for the event, a table laid for a meal, instruments on a stage) and say so in your sentence.",
  "TEXT: render only the words the brief lists or the person asks for, spelled exactly as written: same capitalisation, digits and punctuation. Real, sharp, well-kerned type; never garbled, warped or duplicated. No watermarks and no UI chrome.",
  "LOGO: never invent a logo. When the church's logo is attached, use that exact mark: same shape, colours and proportions, not redrawn, recoloured, cropped or distorted. Give it clear space, usually small in a corner or beside the church name.",
  "EDITING: when given the current design with an instruction, edit that design. Make the requested change clearly and fully, and keep everything else (layout, words, logo, colours, scene) the same unless the change needs it to move.",
  "Always respond with one finished image, plus one short sentence saying what you made or changed.",
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

function parseEvent(value: unknown): ImageChatEventContext | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  const candidate: ImageChatEventContext = {
    title: asTrimmedString(e.title, 200) || undefined,
    when: asTrimmedString(e.when, 120) || undefined,
    location: asTrimmedString(e.location, 200) || undefined,
    details: asTrimmedString(e.details, MAX_EVENT_DETAILS_CHARS) || undefined,
  };
  return candidate.title || candidate.when || candidate.location || candidate.details
    ? candidate
    : null;
}

/** Validates an untrusted request body. Messages are written for people. */
export function parseImageChatRequest(body: unknown): ImageChatParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Describe the picture you want." };
  }
  const raw = body as Record<string, unknown>;
  const mode: ImageChatMode = raw.mode === "event" ? "event" : "describe";
  const event = parseEvent(raw.event);

  if (mode === "event") {
    if (!event?.title) {
      return { ok: false, error: "Add a title first, so the picture has something to say." };
    }
    // A picture made from the event is always a fresh design.
    return {
      ok: true,
      request: {
        mode,
        instruction: IMAGE_CHAT_EVENT_INSTRUCTION,
        history: [],
        previousImage: null,
        event,
      },
    };
  }

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

  return { ok: true, request: { mode, instruction: instructionRaw, history, previousImage, event } };
}

/** Whether the person's wording asks for people, which the image must not show. */
export function mentionsPeople(text: string): boolean {
  return PEOPLE_WORDS.test(text);
}

function eventLines(event: ImageChatEventContext | null): string[] {
  if (!event) return [];
  return [
    event.title ? `Title: "${event.title}"` : null,
    event.when ? `When: "${event.when}"` : null,
    event.location ? `Where: "${event.location}"` : null,
  ].filter((line): line is string => Boolean(line));
}

function brandLines(brand: ImageChatBrand | null, { forEdit }: { forEdit: boolean }): string[] {
  if (!brand) return [];
  return [
    forEdit
      ? null
      : `COLOUR: build the palette from the church's colours, ${brand.primaryColor} and ${brand.accentColor}, unless the person asks for other colours.`,
    brand.logo
      ? forEdit
        ? "LOGO: keep the church's attached logo exactly as it is unless the instruction is about the logo."
        : "LOGO: place the church's attached logo, unaltered, small and clean in a corner or beside the church name."
      : null,
  ].filter((line): line is string => Boolean(line));
}

/** A finished event graphic, designed from what the church wrote. */
function buildEventBrief(request: ImageChatRequest, brand: ImageChatBrand | null): string {
  const event = request.event ?? {};
  const details = [event.when, event.location]
    .filter((part): part is string => Boolean(part))
    .map((part) => `"${part}"`);
  const description = event.details?.trim();
  const subject = [event.title, description].filter(Boolean).join(" ");
  return [
    "Design a complete, ready-to-post CHURCH EVENT GRAPHIC: 16:9 landscape, shown at 1200×630.",
    "HERO IMAGE: a striking scene that clearly says what this event is, chosen from the title" +
      (description ? " and the description below." : "."),
    description
      ? `EVENT DESCRIPTION (use it to choose the scene, mood and props; do not print it): ${description}`
      : null,
    "TEXT TO RENDER (the only words allowed in the image, each copied character for character):",
    event.title ? `- Large hero title: "${event.title}". The dominant element.` : null,
    brand ? `- Church name: "${brand.churchName}", small, clean, letter-spaced.` : null,
    details.length ? `- Details, small, on one or two lines: ${details.join(" · ")}.` : null,
    ...brandLines(brand, { forEdit: false }),
    "LAYOUT: set the words on the calmer side over a soft gradient or a brand-colour panel so they are crisp and high-contrast; keep the hero scene clearly visible on the other side.",
    mentionsPeople(subject) ? "Reminder: no people may appear. Show the place and things instead." : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The text of the final user turn: the instruction plus its framing. */
export function buildImageChatInstruction(
  request: ImageChatRequest,
  brand: ImageChatBrand | null = null,
): string {
  if (request.mode === "event") return buildEventBrief(request, brand);

  const editing = Boolean(request.previousImage);
  const lines = eventLines(request.event);
  const parts = [
    editing
      ? `Edit the CURRENT DESIGN. Make exactly this change, fully and visibly: ${request.instruction}`
      : `Create a new 16:9 landscape graphic (shown at 1200×630). Follow this description exactly, including every subject, colour, style and word it names: ${request.instruction}`,
    ...brandLines(brand, { forEdit: editing }),
    lines.length
      ? `EVENT DETAILS (for reference; only put these words in the image if asked, and then copy them exactly): ${lines.join(" · ")}`
      : null,
    brand && !editing
      ? `The church is "${brand.churchName}"; only print its name if asked.`
      : null,
    mentionsPeople(request.instruction)
      ? "Reminder: no people may appear. Show the place and things instead."
      : null,
  ];
  return parts.filter(Boolean).join("\n");
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
export type ImageChatContent = { role: "user" | "model"; parts: GeminiPart[] };

/**
 * Gemini `contents` for one turn: earlier turns as text, then the church's
 * logo and the current image (each labelled, so the model knows which is
 * which) and the framed instruction. Only the latest image is sent; earlier
 * versions would multiply the payload for little benefit.
 *
 * Gemini expects turns to alternate and to start with the user, so the text
 * history is normalised to that shape.
 */
export function buildImageChatContents(
  request: ImageChatRequest,
  brand: ImageChatBrand | null = null,
): ImageChatContent[] {
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
  if (brand?.logo) {
    finalParts.push(
      { text: "CHURCH LOGO (the church's real logo; reproduce this exact mark):" },
      { inlineData: { mimeType: brand.logo.mimeType, data: brand.logo.data } },
    );
  }
  if (request.previousImage) {
    finalParts.push(
      { text: "CURRENT DESIGN (edit this image):" },
      { inlineData: { mimeType: request.previousImage.mimeType, data: request.previousImage.data } },
    );
  }
  finalParts.push({ text: buildImageChatInstruction(request, brand) });

  const last = contents[contents.length - 1];
  if (last && last.role === "user") {
    // History ended on a user turn (an earlier attempt that failed): fold it in.
    last.parts.push(...finalParts);
  } else {
    contents.push({ role: "user", parts: finalParts });
  }
  return contents;
}
