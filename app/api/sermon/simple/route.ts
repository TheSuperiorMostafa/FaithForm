import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import {
  validateSimpleSermonBody,
  type SimpleSermonSaveBody,
} from "@/lib/sermon-builder/simple-sermon-save";
import { createSermon } from "@/lib/queries/sermons";
import { featureAccessDenied } from "@/lib/features/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const body = (await request.json()) as SimpleSermonSaveBody;

    const validated = await validateSimpleSermonBody(body);
    if ("error" in validated) {
      return NextResponse.json(
        { error: validated.error },
        { status: validated.status },
      );
    }

    const sermon = await createSermon({
      churchId: auth.churchId,
      userId: auth.userId,
      title: validated.title,
      topic: "",
      scripture_refs: validated.scripture_refs,
      audience: "General congregation",
      duration_min: 0,
      kind: "simple",
      theme_id: validated.theme_id,
      translation: validated.translation,
      sermon_date: validated.sermon_date,
    });

    return NextResponse.json({ sermon: { id: sermon.id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create sermon";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
