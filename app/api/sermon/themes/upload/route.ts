import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { UPLOADS_CATEGORY } from "@/lib/queries/slide-themes";
import { rowToSlideTheme, type SlideThemeRow } from "@/lib/sermon-builder/slide-theme-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "sermon-themes";

/**
 * 4MB, because that is what actually arrives. Vercel refuses a request body
 * over 4.5MB before this handler runs, and the bucket itself is capped at 5MB.
 * The button offered 10MB and a phone photo took it up on that, so the upload
 * died in the framework with no message this app wrote. Photos above this are
 * shrunk in the browser before they are sent.
 */
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

/** Uploads must not collide with the platform catalog's hand-picked ids. */
function uploadThemeId(): string {
  return `upload-${crypto.randomUUID()}`;
}

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const extension = ALLOWED.get(file.type);
    if (!extension) {
      return NextResponse.json(
        { error: "Upload a JPG, PNG, or WebP image." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Images must be 4MB or smaller." },
        { status: 400 },
      );
    }

    const rawName = form.get("name")?.toString().trim();
    const name =
      (rawName || file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "))
        .slice(0, 60) || "My theme";

    // Light text on a dark scrim is the safe default over an unknown photo.
    const textColor = form.get("text_color")?.toString().trim() || "FFFFFF";
    const accentColor = form.get("accent_color")?.toString().trim() || "C9A227";

    const supabase = createClient();
    const id = uploadThemeId();
    const path = `${auth.churchId}/${id}.${extension}`;

    // The object is written with the service client. The bucket only ever had
    // a public *read* policy, so a church's own session was refused at the
    // storage layer on every upload ("new row violates row-level security"),
    // which is where "upload your own theme" had been failing. The caller is
    // already authenticated, feature-checked, and the path is prefixed with
    // their church id, so the tenant boundary is this handler's, not the
    // bucket's. The row below still goes through the church's own session,
    // where the table policy decides.
    const storage = createAdminClient().storage.from(BUCKET);

    const { error: uploadError } = await storage.upload(
      path,
      Buffer.from(await file.arrayBuffer()),
      { contentType: file.type, upsert: false },
    );

    if (uploadError) {
      console.error("[sermon-themes] upload failed:", uploadError.message);
      return NextResponse.json(
        { error: `Could not store the image: ${uploadError.message}` },
        { status: 500 },
      );
    }

    const { data, error } = await supabase
      .from("slide_themes")
      .insert({
        id,
        church_id: auth.churchId,
        created_by: auth.userId,
        name,
        description: "Uploaded by your church",
        category: UPLOADS_CATEGORY,
        tags: ["custom", "uploaded"],
        background_type: "image",
        image_path: path,
        text_color: textColor.replace(/^#/, "").toUpperCase(),
        accent_color: accentColor.replace(/^#/, "").toUpperCase(),
        text_shadow: true,
        active: true,
      })
      .select("*")
      .single();

    if (error || !data) {
      // Don't leave the orphaned object behind if the row failed.
      await storage.remove([path]);
      console.error("[sermon-themes] row insert failed:", error?.message);
      return NextResponse.json(
        { error: error?.message ?? "Could not save the theme" },
        { status: 500 },
      );
    }

    return NextResponse.json({ theme: rowToSlideTheme(data as SlideThemeRow) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing theme id" }, { status: 400 });
    }

    const supabase = createClient();
    const { data: existing } = await supabase
      .from("slide_themes")
      .select("id, image_path, church_id")
      .eq("id", id)
      .eq("church_id", auth.churchId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Theme not found" }, { status: 404 });
    }

    const { error } = await supabase.from("slide_themes").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Same service client as the upload: the bucket grants browsers no writes.
    // The row was already deleted through the church's own session above, so
    // the object being removed is one this church proved it owned.
    if (existing.image_path) {
      await createAdminClient().storage.from(BUCKET).remove([existing.image_path]);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
