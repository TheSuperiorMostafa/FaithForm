import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import {
  deleteSermon,
  updateSermon,
  verifySermonAccess,
} from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";
import { featureAccessDenied } from "@/lib/features/guard";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, params.id, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const updated = await updateSermon(params.id, body);
    return NextResponse.json({ sermon: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, params.id, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (sermon.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft sermons can be deleted" },
        { status: 400 },
      );
    }

    await deleteSermon(params.id);
    return NextResponse.json({ success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
