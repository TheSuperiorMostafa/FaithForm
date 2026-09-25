import { NextResponse } from "next/server";

import { requireChurchAuth } from "@/lib/auth/church";
import { generateSocialPreview } from "@/lib/social/generate-preview";
import { createAdminClient } from "@/lib/supabase/admin";
import { featureAccessDenied } from "@/lib/features/guard";
import { toUserError } from "@/lib/errors/user-error";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type SocialPreviewRequest = {
  title?: string;
  location?: string;
  startAt?: string;
  endAt?: string | null;
  allDay?: boolean;
  notes?: string;
  googleEventId?: string | null;
  announcementId?: string | null;
  /** Caption only: the church has uploaded its own image. */
  skipImage?: boolean;
};

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("announcements");
    if (denied) return denied;
    const body = (await request.json()) as SocialPreviewRequest;

    const title = body.title?.trim();
    const startAt = body.startAt?.trim();

    if (!title) {
      return NextResponse.json(
        { error: "Add a title first, so the picture has something to say." },
        { status: 400 },
      );
    }
    if (!startAt) {
      return NextResponse.json({ error: "Choose the day first." }, { status: 400 });
    }

    const admin = createAdminClient();
    const preview = await generateSocialPreview(admin, {
      churchId: auth.churchId,
      title,
      location: body.location?.trim() ?? "",
      startAt,
      endAt: body.endAt ?? null,
      allDay: Boolean(body.allDay),
      notes: body.notes?.trim(),
      googleEventId: body.googleEventId ?? null,
      announcementId: body.announcementId ?? null,
      skipImage: body.skipImage === true,
    });

    return NextResponse.json({ preview });
  } catch (e) {
    if (e instanceof Error && e.message === "Unauthorized") {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }
    return NextResponse.json(
      { error: toUserError(e, "We couldn't make a picture right now") },
      { status: 500 },
    );
  }
}
