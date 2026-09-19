import { NextResponse } from "next/server";
import { z } from "zod";
import { getChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function authorize() {
  const auth = await getChurchAuth();
  if (!auth) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!auth.isAdmin) return { response: NextResponse.json({ error: "Only church admins can link a presentation." }, { status: 403 }) };
  for (const feature of ["live_stream", "sermon_builder", "member_app"] as const) {
    const denied = await featureAccessDenied(feature);
    if (denied) return { response: denied };
  }
  return { auth };
}

export async function GET(request: Request) {
  const access = await authorize();
  if (access.response) return access.response;
  const churchId = access.auth!.churchId;
  const params = new URL(request.url).searchParams;
  const sermonId = params.get("sermonId");
  const page = z.coerce.number().int().min(0).max(100_000).safeParse(params.get("offset") ?? 0);
  if (!page.success) return NextResponse.json({ error: "Invalid page." }, { status: 400 });
  const offset = page.data;
  if (sermonId && !z.string().uuid().safeParse(sermonId).success) {
    return NextResponse.json({ error: "Invalid sermon." }, { status: 400 });
  }
  const admin = createAdminClient();
  let presentations = admin.from("sermon_presentation_versions")
    .select("id, sermon_id, version, mobile_visibility, unpublished_at, sermons!inner(title)")
    .eq("church_id", churchId).order("published_at", { ascending: false });
  if (sermonId) presentations = presentations.eq("sermon_id", sermonId);
  const [events, versions] = await Promise.all([
    admin.from("stream_events").select("id, title, starts_at, status").eq("church_id", churchId)
      .neq("status", "cancelled").order("starts_at", { ascending: false }).order("id").range(offset, offset + 199),
    presentations.order("id").range(offset, offset + 199),
  ]);
  if (events.error || versions.error) {
    return NextResponse.json({ error: "Service links could not be loaded." }, { status: 503 });
  }
  const eventIds = (events.data ?? []).map(event => event.id);
  const links = eventIds.length ? await admin.from("stream_event_presentations").select("event_id, presentation_id")
    .eq("church_id", churchId).in("event_id", eventIds) : { data: [], error: null };
  if (links.error) return NextResponse.json({ error: "Service links could not be loaded." }, { status: 503 });
  return NextResponse.json({ events: events.data, presentations: versions.data, links: links.data,
    nextOffset: events.data?.length === 200 || versions.data?.length === 200 ? offset + 200 : null },
    { headers: { "Cache-Control": "private, no-store" } });
}

const bodySchema = z.object({ eventId: z.string().uuid(), presentationId: z.string().uuid().nullable() }).strict();

export async function PATCH(request: Request) {
  const access = await authorize();
  if (access.response) return access.response;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Choose a service and presentation." }, { status: 400 });
  const churchId = access.auth!.churchId;
  const admin = createAdminClient();
  const { eventId, presentationId } = body.data;
  const { data: event, error: eventError } = await admin.from("stream_events").select("id")
    .eq("id", eventId).eq("church_id", churchId).maybeSingle();
  if (eventError) return NextResponse.json({ error: "Service links are unavailable." }, { status: 503 });
  if (!event) return NextResponse.json({ error: "Service not found." }, { status: 404 });
  if (presentationId) {
    const { data: presentation, error } = await admin.from("sermon_presentation_versions").select("id")
      .eq("id", presentationId).eq("church_id", churchId).neq("mobile_visibility", "none")
      .is("unpublished_at", null).maybeSingle();
    if (error) return NextResponse.json({ error: "Presentations are unavailable." }, { status: 503 });
    if (!presentation) return NextResponse.json({ error: "Choose a presentation shared in the app." }, { status: 404 });
  }
  const result = presentationId
    ? await admin.from("stream_event_presentations").upsert({ event_id: eventId, church_id: churchId, presentation_id: presentationId }, { onConflict: "event_id" })
    : await admin.from("stream_event_presentations").delete().eq("event_id", eventId).eq("church_id", churchId);
  if (result.error) return NextResponse.json({ error: "The service link could not be saved." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
