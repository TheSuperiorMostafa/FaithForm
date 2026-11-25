import { NextResponse } from "next/server";
import { shareListsFile } from "@/lib/service-plans/share";
import { buildPlanView } from "@/lib/service-plans/view";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { loadSharedPlanByToken, shareViewOptions } from "../../../load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "song-files";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLES = { item: "plan_item_attachments", song: "song_attachments" } as const;

function notFound() {
  return NextResponse.json(
    { error: "That file isn't available on this link." },
    { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}

/**
 * Opens one file shown on a share link. The token is the credential: the file
 * must be one this link's own view lists (on its rows, or a Person view's
 * songs), so an Order only link cannot reach any, and it is served through a
 * two-minute signed URL from the private bucket.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; source: string; fileId: string }> },
) {
  const { token, source, fileId } = await params;
  if ((source !== "item" && source !== "song") || !UUID.test(fileId)) return notFound();
  const loaded = await loadSharedPlanByToken(token);
  if (!loaded) return notFound();
  const { share, plan } = loaded;

  const view = buildPlanView(plan, shareViewOptions(share));
  if (!shareListsFile(plan, view, source, fileId)) return notFound();

  const admin = createAdminClientOrNull();
  if (!admin) return notFound();
  const { data, error } = await admin
    .from(TABLES[source])
    .select("storage_path")
    .eq("church_id", share.church_id)
    .eq("id", fileId)
    .maybeSingle();
  const path = (data?.storage_path as string | null | undefined) ?? null;
  if (error || !path || !path.startsWith(`${share.church_id}/`)) return notFound();

  const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 120);
  if (signed.error || !signed.data) {
    console.error("service-plans share file:", signed.error?.message);
    return notFound();
  }
  return NextResponse.redirect(signed.data.signedUrl, {
    status: 303,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" },
  });
}
