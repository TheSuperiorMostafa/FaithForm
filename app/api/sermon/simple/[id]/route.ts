import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { validateSimpleSermonBody } from "@/lib/sermon-builder/simple-sermon-save";
import type { SimpleSermonSaveBody } from "@/lib/sermon-builder/simple-sermon-save";
import { updateSermon, verifySermonAccess } from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireChurchAuth();
    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, params.id, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if ((sermon.kind ?? "advanced") !== "simple") {
      return NextResponse.json(
        { error: "Only slide decks can be edited here" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as SimpleSermonSaveBody;
    const validated = await validateSimpleSermonBody(body);
    if ("error" in validated) {
      return NextResponse.json(
        { error: validated.error },
        { status: validated.status },
      );
    }

    const updated = await updateSermon(params.id, {
      title: validated.title,
      translation: validated.translation,
      theme_id: validated.theme_id,
      sermon_date: validated.sermon_date,
      scripture_refs: validated.scripture_refs,
    });

    return NextResponse.json({ sermon: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
