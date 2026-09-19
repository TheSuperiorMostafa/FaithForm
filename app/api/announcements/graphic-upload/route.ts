import { NextResponse } from "next/server";

import {
  MAX_GRAPHIC_UPLOAD_BYTES,
  prepareUploadedGraphic,
} from "@/app/api/announcements/graphic-upload/prepare";
import { requireChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { SOCIAL_GRAPHICS_BUCKET } from "@/lib/social/constants";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Room for the multipart envelope around a file that is itself within the cap. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * A church's own design for the Facebook post, which is also the app poster.
 *
 * Answers with the same `{ graphicUrl, graphicPath }` the AI preview returns,
 * so publishing works unchanged: the file goes in the church's folder of the
 * same bucket, which is where publish already downloads from. Its name starts
 * with `upload-` and is new every time, so a regenerated AI flyer, which
 * overwrites its own draft key, can never land on top of it.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("announcements");
    if (denied) return denied;

    // Refused on the declared length before the body is read. Vercel would
    // refuse it anyway; local and self-hosted servers would not.
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_GRAPHIC_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return NextResponse.json(
        { error: "Images must be 4MB or smaller." },
        { status: 413 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
    }
    if (file.size > MAX_GRAPHIC_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Images must be 4MB or smaller." },
        { status: 413 },
      );
    }

    const prepared = await prepareUploadedGraphic(Buffer.from(await file.arrayBuffer()));
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: 400 });
    }

    const graphicPath = `${auth.churchId}/upload-${crypto.randomUUID()}.${prepared.image.ext}`;

    // Written with the service client, as the AI flyers are. The bucket lets
    // only church admins write from a browser, but announcements are also run
    // by members who have been given the feature. The caller is authenticated
    // and feature-checked, and the path starts with their own church's id, so
    // the tenant boundary is enforced here rather than by the bucket.
    const storage = createAdminClient().storage.from(SOCIAL_GRAPHICS_BUCKET);
    const { error } = await storage.upload(graphicPath, prepared.image.buffer, {
      contentType: prepared.image.contentType,
      upsert: false,
    });

    if (error) {
      console.error("[announcements] graphic upload failed:", error.message);
      return NextResponse.json(
        { error: "That image could not be saved. Please try again." },
        { status: 500 },
      );
    }

    const { data } = storage.getPublicUrl(graphicPath);
    return NextResponse.json({ graphicUrl: data.publicUrl, graphicPath });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
