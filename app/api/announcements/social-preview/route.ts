import { NextResponse } from "next/server";

import { requireChurchAuth } from "@/lib/auth/church";
import { generateSocialPreview } from "@/lib/social/generate-preview";
import { createAdminClient } from "@/lib/supabase/admin";
import { featureAccessDenied } from "@/lib/features/guard";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type SocialPreviewRequest = {
  title?: string;
  location?: string;
  startAt?: string;
  endAt?: string | null;
  notes?: string;
  googleEventId?: string | null;
  announcementId?: string | null;
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
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!startAt) {
      return NextResponse.json({ error: "Start time is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const preview = await generateSocialPreview(admin, {
      churchId: auth.churchId,
      title,
      location: body.location?.trim() ?? "",
      startAt,
      endAt: body.endAt ?? null,
      notes: body.notes?.trim(),
      googleEventId: body.googleEventId ?? null,
      announcementId: body.announcementId ?? null,
    });

    return NextResponse.json({ preview });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Social preview failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
