import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import {
  deleteSermon,
  updateSermon,
  verifySermonAccess,
} from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";
import { featureAccessDenied } from "@/lib/features/guard";
import { parseSermonEditorPatch } from "@/lib/sermon-builder/sermon-patch";
import { SERMON_NOT_FOUND_MESSAGE, sermonRouteError } from "@/lib/sermon-builder/route-error";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, id, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: SERMON_NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = parseSermonEditorPatch(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const updated = await updateSermon(id, parsed.patch);
    return NextResponse.json({ sermon: updated });
  } catch (e) {
    return sermonRouteError(e, "We couldn't save your change to this sermon.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, id, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: SERMON_NOT_FOUND_MESSAGE }, { status: 404 });
    }

    if (sermon.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft sermons can be deleted here. Open the sermon to delete it." },
        { status: 400 },
      );
    }

    await deleteSermon(id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return sermonRouteError(e, "We couldn't delete this sermon.");
  }
}
