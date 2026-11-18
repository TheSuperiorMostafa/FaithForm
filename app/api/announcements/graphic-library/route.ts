import { NextResponse } from "next/server";

import {
  GRAPHIC_MAX_EDGE,
  MAX_GRAPHIC_UPLOAD_BYTES,
  prepareUploadedGraphic,
} from "@/app/api/announcements/graphic-upload/prepare";
import { normalizeSiteImage } from "@/lib/security/validate-image";
import { requireChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import { featureAccessDenied } from "@/lib/features/guard";
import { listChurchImageLibrary, listStockImages, readPickedImage } from "@/lib/media/image-library";
import { SOCIAL_GRAPHICS_BUCKET } from "@/lib/social/constants";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(error: unknown) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  return null;
}

/** The church's earlier pictures and FaithForm's stock pictures, for the event picture picker. */
export async function GET() {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("announcements");
    if (denied) return denied;

    const admin = createAdminClient();
    const [library, stock] = await Promise.all([
      listChurchImageLibrary(admin, auth.churchId),
      listStockImages(),
    ]);
    return NextResponse.json({ library, stock });
  } catch (error) {
    return (
      unauthorized(error) ??
      NextResponse.json({ error: toUserError(error, "Your pictures couldn't be loaded.") }, { status: 500 })
    );
  }
}

/**
 * Uses a library or stock picture for an announcement. Answers like the upload
 * route, `{ graphicUrl, graphicPath }`, so publishing is unchanged: an earlier
 * event upload is reused where it is; anything else is copied into the
 * church's folder of the social graphics bucket first.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("announcements");
    if (denied) return denied;

    const body = (await request.json().catch(() => null)) as { kind?: unknown; id?: unknown } | null;
    const kind = body?.kind === "library" || body?.kind === "stock" ? body.kind : null;
    const id = typeof body?.id === "string" ? body.id : "";
    if (!kind || !id) {
      return NextResponse.json({ error: "Choose a picture." }, { status: 400 });
    }

    const admin = createAdminClient();
    const storage = admin.storage.from(SOCIAL_GRAPHICS_BUCKET);

    const picked = await readPickedImage(admin, auth.churchId, { kind, id });
    if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: 400 });

    if (picked.bucket === SOCIAL_GRAPHICS_BUCKET && picked.path) {
      return NextResponse.json({
        graphicUrl: storage.getPublicUrl(picked.path).data.publicUrl,
        graphicPath: picked.path,
      });
    }

    // Stock photos can be larger than an upload may be; scale them first.
    let bytes = picked.bytes;
    if (bytes.byteLength > MAX_GRAPHIC_UPLOAD_BYTES) {
      const smaller = await normalizeSiteImage(bytes, { maxEdge: GRAPHIC_MAX_EDGE });
      if (!smaller) return NextResponse.json({ error: "That picture couldn't be opened. Try another one." }, { status: 400 });
      bytes = smaller.buffer;
    }
    const prepared = await prepareUploadedGraphic(bytes);
    if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });

    const graphicPath = `${auth.churchId}/upload-${crypto.randomUUID()}.${prepared.image.ext}`;
    const { error } = await storage.upload(graphicPath, prepared.image.buffer, {
      contentType: prepared.image.contentType,
      upsert: false,
    });
    if (error) {
      console.error("[announcements] library picture copy failed:", error.message);
      return NextResponse.json({ error: "That picture could not be saved. Please try again." }, { status: 500 });
    }

    return NextResponse.json({ graphicUrl: storage.getPublicUrl(graphicPath).data.publicUrl, graphicPath });
  } catch (error) {
    return (
      unauthorized(error) ??
      NextResponse.json({ error: toUserError(error, "That picture could not be used.") }, { status: 500 })
    );
  }
}
