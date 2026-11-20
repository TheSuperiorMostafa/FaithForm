import { NextResponse } from "next/server";

import { featureAccessDenied } from "@/lib/features/guard";
import { requireChurchContext } from "@/lib/reports/auth";
import { planPdfFileName, renderPlanPdf, type PlanPdfOrientation } from "@/lib/service-plans/pdf";
import { getPlan } from "@/lib/service-plans/queries";
import {
  NOTE_CATEGORIES,
  SHARE_PRESETS,
  type NoteCategory,
  type SharePreset,
} from "@/lib/service-plans/types";
import { presetDefaults, type PlanViewOptions } from "@/lib/service-plans/view";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/plans/:planId/pdf
 *
 *   preset       full | team | person | order (default full)
 *   categories   comma list of note categories; empty = none (default: the preset's, or the team's)
 *   teamId       team view: whose note categories to use by default
 *   personId     person view: whose items (required for person)
 *   timeId       which plan time the start times count from
 *   times, lengths, descriptions, leaders   1 | 0 (default: the preset's)
 *   orientation  portrait | landscape (default portrait)
 *   download     1 = save as a file instead of showing inline
 *
 * Read with the signed-in user's own client, so RLS decides what they see.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BadQuery extends Error {}

function bad(message: string): never {
  throw new BadQuery(message);
}

function optionalUuid(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  if (value === null || value === "") return null;
  if (!UUID.test(value)) bad(`Invalid ${key}`);
  return value.toLowerCase();
}

function flag(params: URLSearchParams, key: string): boolean | null {
  const value = params.get(key);
  if (value === null || value === "") return null;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  bad(`Invalid ${key}`);
}

function categoriesParam(params: URLSearchParams): NoteCategory[] | null {
  const value = params.get("categories");
  if (value === null) return null;
  const list = value
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (list.some((c) => !(NOTE_CATEGORIES as readonly string[]).includes(c))) bad("Invalid categories");
  return NOTE_CATEGORIES.filter((c) => list.includes(c));
}

function validTimeZone(zone: string | null | undefined): string {
  const candidate = zone || "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return "America/New_York";
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  if (!UUID.test(planId)) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const supabase = createClient();
  const ctx = await requireChurchContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await featureAccessDenied("service_plans", supabase);
  if (denied) return denied;
  const { churchId } = ctx;

  const query = new URL(request.url).searchParams;
  let preset: SharePreset;
  let requested: {
    categories: NoteCategory[] | null;
    teamId: string | null;
    personId: string | null;
    timeId: string | null;
    orientation: PlanPdfOrientation;
    download: boolean;
    times: boolean | null;
    lengths: boolean | null;
    descriptions: boolean | null;
    leaders: boolean | null;
  };
  try {
    const rawPreset = query.get("preset") || "full";
    if (!(SHARE_PRESETS as readonly string[]).includes(rawPreset)) bad("Invalid preset");
    preset = rawPreset as SharePreset;
    const orientation = query.get("orientation") || "portrait";
    if (orientation !== "portrait" && orientation !== "landscape") bad("Invalid orientation");
    requested = {
      categories: categoriesParam(query),
      teamId: optionalUuid(query, "teamId"),
      personId: optionalUuid(query, "personId"),
      timeId: optionalUuid(query, "timeId"),
      orientation,
      download: flag(query, "download") ?? false,
      times: flag(query, "times"),
      lengths: flag(query, "lengths"),
      descriptions: flag(query, "descriptions"),
      leaders: flag(query, "leaders"),
    };
    if (preset === "person" && !requested.personId) bad("Choose a person");
  } catch (error) {
    if (error instanceof BadQuery) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }

  try {
    const [plan, church, team] = await Promise.all([
      getPlan(supabase, churchId, planId),
      supabase
        .from("churches")
        .select("name, timezone, logo_url, giving_primary_color, giving_accent_color")
        .eq("id", churchId)
        .maybeSingle(),
      preset === "team" && requested.teamId
        ? Promise.all([
            supabase
              .from("teams")
              .select("id, name")
              .eq("church_id", churchId)
              .eq("id", requested.teamId)
              .maybeSingle(),
            supabase
              .from("team_note_categories")
              .select("category")
              .eq("church_id", churchId)
              .eq("team_id", requested.teamId),
          ])
        : Promise.resolve(null),
    ]);
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (church.error) throw church.error;
    if (requested.timeId && !plan.times.some((t) => t.id === requested.timeId)) {
      return NextResponse.json({ error: "Invalid timeId" }, { status: 400 });
    }

    let teamName: string | null = null;
    let teamCategories: NoteCategory[] | null = null;
    if (team) {
      const [teamRow, categoryRows] = team;
      if (teamRow.error) throw teamRow.error;
      if (categoryRows.error) throw categoryRows.error;
      if (!teamRow.data) return NextResponse.json({ error: "Team not found" }, { status: 404 });
      teamName = teamRow.data.name as string;
      const rows = (categoryRows.data ?? []).map((r) => r.category as string);
      teamCategories = NOTE_CATEGORIES.filter((c) => rows.includes(c));
    }

    const defaults = presetDefaults(preset);
    const options: PlanViewOptions = {
      ...defaults,
      categories: requested.categories ?? teamCategories ?? defaults.categories,
      personId: requested.personId,
      timeId: requested.timeId,
      showTimes: requested.times ?? defaults.showTimes,
      showLengths: requested.lengths ?? defaults.showLengths,
      showDescriptions: requested.descriptions ?? defaults.showDescriptions,
      showLeaders: requested.leaders ?? defaults.showLeaders,
    };

    let audience: string | null = null;
    if (preset === "team" && teamName) audience = teamName;
    if (preset === "person") {
      const name =
        plan.team.find((m) => m.personId === requested.personId)?.personName ??
        plan.items.flatMap((i) => i.leaders).find((l) => l.personId === requested.personId)?.name;
      audience = name ? `For ${name}` : null;
    }

    const buffer = await renderPlanPdf({
      plan,
      options,
      churchName: (church.data?.name as string | null) || "Your Church",
      timeZone: validTimeZone(church.data?.timezone as string | null),
      logoSrc: (church.data?.logo_url as string | null) ?? null,
      orientation: requested.orientation,
      brand: {
        primary: (church.data?.giving_primary_color as string | null) ?? null,
        accent: (church.data?.giving_accent_color as string | null) ?? null,
      },
      audience,
    });

    const filename = planPdfFileName(plan, preset);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${requested.download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("plan pdf:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "We couldn't make this PDF. Try again." }, { status: 500 });
  }
}
