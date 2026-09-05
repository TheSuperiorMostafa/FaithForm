import { NextResponse } from "next/server";

import { getChurchAuth } from "@/lib/auth/church";
import { MEMBER_FILES_BUCKET } from "@/lib/checkin/member-files";
import { requireFeatureApi } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Hands back one person-document, checking who is asking on every request.
 *
 * Deliberately not a signed storage URL. A signed URL is a bearer token with a
 * lifetime, and once it is in a browser history, a chat message, or a
 * screenshot it keeps working for anyone who has it — which is the wrong
 * property for a background check. Streaming the bytes through here means the
 * church, the role, and the file's own visibility are all re-checked at the
 * moment of the read, and access ends the moment the person's role does.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const guard = await requireFeatureApi("people");
  if (!guard.ok) return guard.response;

  const auth = await getChurchAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("member_files")
    .select("storage_path, file_name, mime_type, visibility, church_id")
    .eq("id", id)
    .eq("church_id", auth.churchId)
    .maybeSingle();

  // Same answer for "not yours" and "does not exist": a 403 on a guessed id
  // would confirm that the id names a real document in this church.
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (file.visibility !== "staff" && !auth.isAdmin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await admin.storage
    .from(MEMBER_FILES_BUCKET)
    .download(file.storage_path as string);

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      "Content-Type": (file.mime_type as string) || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.file_name}"`,
      // Never cached by a proxy: the authorization is per-request, and a cached
      // copy would outlive the role that permitted it.
      "Cache-Control": "private, no-store",
    },
  });
}
