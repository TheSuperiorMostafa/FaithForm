import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { UPLOADS_CATEGORY } from "@/lib/queries/slide-themes";
import { rowToSlideTheme, type SlideThemeRow } from "@/lib/sermon-builder/slide-theme-shared";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "sermon-themes";
const MAX_BYTES = 10 * 1024 * 1024;
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
        { error: "Images must be 10MB or smaller." },
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

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) {
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
      await supabase.storage.from(BUCKET).remove([path]);
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

    if (existing.image_path) {
      await supabase.storage.from(BUCKET).remove([existing.image_path]);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
