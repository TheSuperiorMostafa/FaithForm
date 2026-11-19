import { NextResponse } from "next/server";

import { isImageChatConfigured, runImageChatTurn } from "@/lib/ai/image/chat";
import { parseImageChatRequest } from "@/lib/ai/image/chat-prompt";
import { requireChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import { featureAccessDenied } from "@/lib/features/guard";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Vercel refuses bodies over 4.5MB; the browser never sends close to this. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Each turn is a paid image generation, so each person gets a sensible budget. */
const PER_USER_LIMIT = { limit: 40, windowMs: 60 * 60 * 1000 };
const PER_CHURCH_LIMIT = { limit: 150, windowMs: 24 * 60 * 60 * 1000 };

/**
 * One turn of the event composer's "Create image with AI" chat.
 *
 * Nothing is stored: the conversation lives in the browser, which sends the
 * current image back to edit it. The image the church picks is saved through
 * /api/announcements/graphic-upload, exactly like a picture they uploaded.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("announcements");
    if (denied) return denied;

    if (!isImageChatConfigured()) {
      return NextResponse.json(
        { error: "Creating pictures with AI isn't available right now." },
        { status: 503 },
      );
    }

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "That picture is too large to edit. Start a new one." },
        { status: 413 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Describe the picture you want." }, { status: 400 });
    }
    const parsed = parseImageChatRequest(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    for (const [key, options] of [
      [`ai-image-chat:user:${auth.userId}`, PER_USER_LIMIT],
      [`ai-image-chat:church:${auth.churchId}`, PER_CHURCH_LIMIT],
    ] as const) {
      const budget = await checkRateLimit(key, options);
      if (!budget.ok) {
        return NextResponse.json(
          {
            error:
              budget.reason === "limited"
                ? "You've made a lot of pictures in a short time. Please wait a while and try again."
                : "Creating pictures isn't available right now. Please try again in a minute.",
          },
          { status: budget.reason === "limited" ? 429 : 503, headers: { "Retry-After": String(budget.retryAfterSeconds) } },
        );
      }
    }

    const result = await runImageChatTurn(parsed.request);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "Unauthorized") {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }
    return NextResponse.json(
      { error: toUserError(e, "We couldn't make that picture right now") },
      { status: 500 },
    );
  }
}
