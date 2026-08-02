"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  getChurchProfile,
  profileToFormState,
  upsertChurchProfile,
} from "@/lib/queries/church-profile";
import { normalizeSiteImage } from "@/lib/security/validate-image";
import { getAspect, type ImageAspectKey } from "@/lib/sites/image-aspects";
import { generateSite } from "@/lib/sites/generate";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import {
  diffPatch,
  resolveSectionBaseline,
  sanitizeCustomCss,
  sanitizeTokens,
} from "@/lib/sites/resolve";
import { buildSiteProfile, getSiteBundle } from "@/lib/sites/queries";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Mutations for the Website section.
 *
 * Every action follows the same three steps before touching anything:
 * authenticate, check the `website` feature, then prove the target row belongs
 * to the caller's church. Only then does the admin client get used.
 *
 * The admin client is load-bearing rather than incidental. Migration 0042
 * blocks church admins from UPDATEing `custom_embed` rows at all, so a
 * whole-page reorder would fail on that one row under plain RLS. RLS stays as
 * the backstop for anything reaching PostgREST directly.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const ok: ActionResult = { ok: true };

/** Narrow return type so it also satisfies the richer per-action results. */
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

type Guard =
  | { ok: true; churchId: string; isAdmin: boolean }
  | { ok: false; error: string };

async function guard(): Promise<Guard> {
  const auth = await requireChurchAuth().catch(() => null);
  if (!auth) return { ok: false, error: "You are not signed in." };

  const featureError = await featureActionError("website");
  if (featureError) return { ok: false, error: featureError };

  return { ok: true, churchId: auth.churchId, isAdmin: auth.isAdmin };
}

/** Church admins only — content edits are not open to view-only members. */
async function guardAdmin(): Promise<Guard> {
  const result = await guard();
  if (!result.ok) return result;
  if (!result.isAdmin) {
    return { ok: false, error: "Only church admins can change the website." };
  }
  return result;
}

function refresh() {
  revalidatePath("/dashboard/website");
  revalidatePath("/dashboard/website/pages");
  revalidatePath("/dashboard/website/design");
  revalidatePath("/dashboard/website/sermons");
  revalidatePath("/dashboard/website/messages");
}

/** Confirms a row belongs to this church before it is written to. */
async function ownsRow(
  table: string,
  id: string,
  churchId: string,
): Promise<boolean> {
  const { data } = await createAdminClient()
    .from(table)
    .select("church_id")
    .eq("id", id)
    .maybeSingle();

  return data?.church_id === churchId;
}

// ---------------------------------------------------------------------------
// BUILD THE FIRST DRAFT
// ---------------------------------------------------------------------------

export type CreateWebsiteResult =
  | { ok: true; aiCopyUsed: boolean }
  | { ok: false; error: string };

/**
 * Builds a church's first website from their Church Profile.
 *
 * Structure is decided in code; copy is written by the model where the profile
 * can't supply it (see lib/sites/generate.ts). The page is created as a draft
 * so nothing goes public until the church reviews it and hits publish.
 */
export async function createWebsite(
  themeKey: string,
): Promise<CreateWebsiteResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const supabase = createAdminClient();

  const { data: theme } = await supabase
    .from("site_themes")
    .select("key")
    .eq("key", themeKey)
    .eq("is_active", true)
    .maybeSingle();

  if (!theme) return fail("That design is not available.");

  // Guard against a double-click or two admins building at once — the unique
  // index on (church_id, path) would otherwise surface as a raw database error.
  const { data: existing } = await supabase
    .from("site_pages")
    .select("id")
    .eq("church_id", auth.churchId)
    .eq("path", "/")
    .maybeSingle();

  if (existing) return fail("Your website has already been built.");

  const profile = await buildSiteProfile(auth.churchId);
  if (!profile) return fail("Your church profile could not be loaded.");

  if (!profile.name?.trim()) {
    return fail("Add your church name in Church Profile before building a site.");
  }

  const draft = await generateSite(auth.churchId, profile);

  await supabase.from("site_settings").upsert(
    {
      church_id: auth.churchId,
      theme_key: themeKey,
      is_published: false,
      contact_email: profile.email,
    },
    { onConflict: "church_id" },
  );

  const { data: page, error: pageError } = await supabase
    .from("site_pages")
    .insert({
      church_id: auth.churchId,
      path: "/",
      title: draft.title,
      meta_description: draft.metaDescription,
      status: "draft",
    })
    .select("id")
    .maybeSingle();

  if (pageError || !page) {
    console.error("[website] page insert failed:", pageError?.message);
    return fail("Your website could not be created. Please try again.");
  }

  const { error: sectionsError } = await supabase.from("site_sections").insert(
    draft.sections.map((section, index) => ({
      page_id: page.id as string,
      church_id: auth.churchId,
      type: section.type,
      sort_order: index * 10,
      is_visible: section.isVisible,
      props: section.props,
    })),
  );

  if (sectionsError) {
    // Leaving a page with no sections behind would render an empty site and
    // block a retry on the "already built" check above.
    await supabase.from("site_pages").delete().eq("id", page.id as string);
    console.error("[website] section insert failed:", sectionsError.message);
    return fail("Your website could not be created. Please try again.");
  }

  refresh();
  return { ok: true, aiCopyUsed: draft.aiCopyUsed };
}

// ---------------------------------------------------------------------------
// SECTION CONTENT
// ---------------------------------------------------------------------------

const sectionContentSchema = z.object({
  sectionId: z.string().uuid(),
  content: z.record(z.string(), z.unknown()),
});

/**
 * Saves a section edit as a **minimal** patch in site_overrides.
 *
 * The form submits the fully resolved content, so the diff is taken here
 * against the same cascade with this section's override removed. A field left
 * alone never enters the patch, and a field reset to its inherited value drops
 * back out — which is what lets a later config regeneration still move
 * everything the church has not deliberately overridden.
 */
export async function saveSectionContent(
  input: z.input<typeof sectionContentSchema>,
): Promise<ActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const parsed = sectionContentSchema.safeParse(input);
  if (!parsed.success) return fail("That edit could not be read.");

  const { sectionId, content } = parsed.data;
  const supabase = createAdminClient();

  const { data: row } = await supabase
    .from("site_sections")
    .select("id, church_id, page_id, type, sort_order, is_visible, props")
    .eq("id", sectionId)
    .maybeSingle();

  if (!row || row.church_id !== auth.churchId) {
    return fail("That section does not belong to your church.");
  }

  if (row.type === "custom_embed") {
    return fail("Custom blocks are managed by FaithForm. Contact support to change one.");
  }

  const master = SECTION_REGISTRY[row.type as string];
  if (!master) return fail("That section type is no longer available.");

  const bundle = await getSiteBundle(await slugFor(auth.churchId));
  if (!bundle) return fail("Your website could not be loaded.");

  const baseline = resolveSectionBaseline({
    row: {
      id: row.id as string,
      type: row.type as string,
      sortOrder: (row.sort_order as number) ?? 0,
      isVisible: row.is_visible !== false,
      props: (row.props as Record<string, unknown> | null) ?? {},
    },
    master,
    theme: bundle.theme,
    profile: bundle.profile,
    overrides: bundle.overrides,
    pageId: row.page_id as string,
  });

  const patch = diffPatch(baseline, content);

  // Delete-then-insert rather than upsert: the uniqueness guarantee for
  // section-scope overrides is a *partial* index (`where scope = 'section'`),
  // and PostgREST cannot infer a partial index for ON CONFLICT. Two writers on
  // the same section is not a real scenario, and last-write-wins is what an
  // editor should do anyway.
  await supabase
    .from("site_overrides")
    .delete()
    .eq("church_id", auth.churchId)
    .eq("scope", "section")
    .eq("section_id", sectionId);

  // An empty patch means nothing differs from the inherited value, so the row
  // would be pure noise — the delete above is the whole save.
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("site_overrides").insert({
      church_id: auth.churchId,
      scope: "section",
      section_id: sectionId,
      patch,
    });

    if (error) {
      console.error("[website] override insert failed:", error.message);
      return fail("That change could not be saved.");
    }
  }

  refresh();
  return ok;
}

/** Drops every hand edit for a section, returning it to the generated content. */
export async function resetSection(sectionId: string): Promise<ActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  if (!(await ownsRow("site_sections", sectionId, auth.churchId))) {
    return fail("That section does not belong to your church.");
  }

  await createAdminClient()
    .from("site_overrides")
    .delete()
    .eq("church_id", auth.churchId)
    .eq("scope", "section")
    .eq("section_id", sectionId);

  refresh();
  return ok;
}

// ---------------------------------------------------------------------------
// SECTION VISIBILITY + ORDER
// ---------------------------------------------------------------------------

export async function setSectionVisible(
  sectionId: string,
  visible: boolean,
): Promise<ActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  if (!(await ownsRow("site_sections", sectionId, auth.churchId))) {
    return fail("That section does not belong to your church.");
  }

  const { error } = await createAdminClient()
    .from("site_sections")
    .update({ is_visible: visible })
    .eq("id", sectionId);

  if (error) return fail("That change could not be saved.");

  refresh();
  return ok;
}

/**
 * Rewrites sort_order for a whole page in one go. Taking the full ordered list
 * rather than a move delta keeps the result identical no matter how the client
 * got there, and leaves no window where two sections share a position.
 */
export async function reorderSections(
  sectionIds: string[],
): Promise<ActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const supabase = createAdminClient();

  const { data: rows } = await supabase
    .from("site_sections")
    .select("id, church_id")
    .in("id", sectionIds);

  if (
    !rows ||
    rows.length !== sectionIds.length ||
    rows.some((r) => r.church_id !== auth.churchId)
  ) {
    return fail("Those sections do not belong to your church.");
  }

  for (let index = 0; index < sectionIds.length; index += 1) {
    const { error } = await supabase
      .from("site_sections")
      .update({ sort_order: index * 10 })
      .eq("id", sectionIds[index]);

    if (error) return fail("The new order could not be saved.");
  }

  refresh();
  return ok;
}

// ---------------------------------------------------------------------------
// DESIGN
// ---------------------------------------------------------------------------

const designSchema = z.object({
  themeKey: z.string().min(1).max(64),
  brandTokens: z.record(z.string(), z.string()),
  customCss: z.string().max(20_000).optional(),
});

export async function saveDesign(
  input: z.input<typeof designSchema>,
): Promise<ActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const parsed = designSchema.safeParse(input);
  if (!parsed.success) return fail("Those design settings could not be read.");

  const supabase = createAdminClient();

  const { data: theme } = await supabase
    .from("site_themes")
    .select("key")
    .eq("key", parsed.data.themeKey)
    .eq("is_active", true)
    .maybeSingle();

  if (!theme) return fail("That theme is not available.");

  // Sanitised on the way in as well as at render time. Storing something the
  // renderer would strip anyway just leaves a confusing row behind.
  const { error } = await supabase.from("site_settings").upsert(
    {
      church_id: auth.churchId,
      theme_key: parsed.data.themeKey,
      brand_tokens: sanitizeTokens(parsed.data.brandTokens),
      custom_css: sanitizeCustomCss(parsed.data.customCss ?? null),
    },
    { onConflict: "church_id" },
  );

  if (error) {
    console.error("[website] design save failed:", error.message);
    return fail("Those design settings could not be saved.");
  }

  refresh();
  return ok;
}

// ---------------------------------------------------------------------------
// PUBLISH
// ---------------------------------------------------------------------------

export async function setPublished(published: boolean): Promise<ActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const supabase = createAdminClient();

  const { error: pageError } = await supabase
    .from("site_pages")
    .update({ status: published ? "published" : "draft" })
    .eq("church_id", auth.churchId);

  // is_published drives the noindex tag; page status drives whether the page
  // renders at all. They move together so "published" means one thing.
  const { error: settingsError } = await supabase.from("site_settings").upsert(
    { church_id: auth.churchId, is_published: published },
    { onConflict: "church_id" },
  );

  if (pageError || settingsError) return fail("That change could not be saved.");

  refresh();
  return ok;
}

// ---------------------------------------------------------------------------
// SERMONS / MEDIA
// ---------------------------------------------------------------------------

const mediaSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "A title is required.").max(200),
  series: z.string().trim().max(120).optional(),
  speaker: z.string().trim().max(120).optional(),
  publishedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-06-29.")
    .optional()
    .or(z.literal("")),
  videoUrl: z.string().trim().max(500).optional(),
  thumbnailUrl: z.string().trim().max(500).optional(),
  isPublished: z.boolean().default(true),
});

export async function saveMedia(
  input: z.input<typeof mediaSchema>,
): Promise<ActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const parsed = mediaSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  }

  const v = parsed.data;
  const supabase = createAdminClient();

  const row = {
    church_id: auth.churchId,
    title: v.title,
    series: v.series || null,
    speaker: v.speaker || null,
    published_at: v.publishedAt || null,
    video_url: v.videoUrl || null,
    thumbnail_url: v.thumbnailUrl || null,
    is_published: v.isPublished,
  };

  if (v.id) {
    if (!(await ownsRow("site_media", v.id, auth.churchId))) {
      return fail("That message does not belong to your church.");
    }
    const { error } = await supabase.from("site_media").update(row).eq("id", v.id);
    if (error) return fail("That message could not be saved.");
  } else {
    const { error } = await supabase.from("site_media").insert(row);
    if (error) return fail("That message could not be saved.");
  }

  refresh();
  return ok;
}

export async function deleteMedia(id: string): Promise<ActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  if (!(await ownsRow("site_media", id, auth.churchId))) {
    return fail("That message does not belong to your church.");
  }

  const { error } = await createAdminClient().from("site_media").delete().eq("id", id);
  if (error) return fail("That message could not be removed.");

  refresh();
  return ok;
}

// ---------------------------------------------------------------------------
// IMAGE UPLOAD
// ---------------------------------------------------------------------------

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Stores a church-supplied photo and hands back its public URL.
 *
 * Unlike the logo and cover uploads on the Church Profile page, this writes no
 * database column — website images live inside section props, overrides and
 * site_media, so the caller decides where the URL goes.
 *
 * Files land in the existing public `church-covers` bucket under a per-church
 * `site/` prefix. Paths are prefixed with the church id so one church can never
 * overwrite another's image by guessing a filename, and each upload gets a
 * fresh name so replacing a photo doesn't have to fight CDN caching.
 */
export async function uploadSiteImage(formData: FormData): Promise<UploadResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload." };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That image is over 12MB. Please pick a smaller one." };
  }

  // The cropper sends a rectangle in source-image pixels plus the aspect it was
  // locked to, so the cut happens here against the original file rather than
  // against a downscaled canvas copy in the browser.
  const aspect = getAspect(formData.get("aspect") as ImageAspectKey | null ?? undefined);
  const num = (key: string) => {
    const raw = formData.get(key);
    const parsed = typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };

  const cx = num("cropX");
  const cy = num("cropY");
  const cw = num("cropWidth");
  const ch = num("cropHeight");
  const crop =
    cx !== null && cy !== null && cw !== null && ch !== null
      ? { x: cx, y: cy, width: cw, height: ch }
      : null;

  const normalized = await normalizeSiteImage(Buffer.from(await file.arrayBuffer()), {
    crop,
    // Only force exact dimensions when the image was actually cropped to a
    // locked shape; a free-form logo keeps whatever proportions it arrived in.
    output: crop ? aspect.output : null,
  });

  if (!normalized) {
    return {
      ok: false,
      error: "That file doesn't look like an image we can use. Try a JPG, PNG, or HEIC photo.",
    };
  }

  const name = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${normalized.ext}`;
  const path = `${auth.churchId}/site/${name}`;
  const admin = createAdminClient();

  const { error } = await admin.storage
    .from("church-covers")
    .upload(path, normalized.buffer, {
      contentType: normalized.contentType,
      upsert: false,
    });

  if (error) {
    console.error("[website] image upload failed:", error.message);
    return { ok: false, error: "That image could not be uploaded. Please try again." };
  }

  const { data } = admin.storage.from("church-covers").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

// ---------------------------------------------------------------------------
// CHURCH DETAILS  (profile-backed content, edited from the Website tab)
// ---------------------------------------------------------------------------

const serviceTimeRow = z.object({
  clientId: z.string(),
  id: z.string().optional(),
  label: z.string().trim().min(1, "Every service needs a name.").max(120),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Use a time like 10:30."),
});

const staffRow = z.object({
  clientId: z.string(),
  id: z.string().optional(),
  fullName: z.string().trim().min(1, "Every person needs a name.").max(120),
  title: z.string().max(120),
  bio: z.string().max(2000),
  photoUrl: z.string().max(500),
  isPublic: z.boolean(),
});

const detailsSchema = z.object({
  name: z.string().trim().min(1, "Your church name is required.").max(200),
  denomination: z.string().max(120),
  logoUrl: z.string().max(500),
  coverImageUrl: z.string().max(500),
  address: z.string().max(200),
  city: z.string().max(120),
  state: z.string().max(60),
  zip: z.string().max(20),
  phone: z.string().max(40),
  email: z.string().max(200),
  googleMapsUrl: z.string().max(500),
  missionStatement: z.string().max(4000),
  visionStatement: z.string().max(4000),
  serviceTimes: z.array(serviceTimeRow).max(20),
  staff: z.array(staffRow).max(50),
});

export type SiteDetailsInput = z.input<typeof detailsSchema>;

/**
 * Saves the church facts the website renders — name, address, contact, service
 * times, staff — from inside the Website tab.
 *
 * These write through to the church profile rather than into site_overrides,
 * because they are not website copy: the phone assistant reads the same service
 * times and the same address. Overriding them per-surface would let a church
 * publish 10:30 on the website while the assistant kept telling callers 10:00.
 *
 * The merge is deliberate. `upsertChurchProfile` replaces the whole profile,
 * so the current state is loaded and only these fields are changed — otherwise
 * saving from here would blank out office hours, AI knowledge and socials.
 */
export async function saveSiteDetails(
  input: SiteDetailsInput,
): Promise<ActionResult> {
  const auth = await guardAdmin();
  if (!auth.ok) return fail(auth.error);

  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  }

  const v = parsed.data;
  const admin = createAdminClient();

  const current = await getChurchProfile(auth.churchId, admin);
  if (!current) return fail("Your church profile could not be loaded.");

  const form = profileToFormState(current);

  try {
    await upsertChurchProfile(
      auth.churchId,
      {
        ...form,
        name: v.name,
        denomination: v.denomination,
        logoUrl: v.logoUrl,
        coverImageUrl: v.coverImageUrl,
        address: v.address,
        city: v.city,
        state: v.state,
        zip: v.zip,
        phone: v.phone,
        email: v.email,
        googleMapsUrl: v.googleMapsUrl,
        missionStatement: v.missionStatement,
        visionStatement: v.visionStatement,
        // Existing rows keep their id, so end_time, kind, notes and the
        // AI-priority flags on staff survive a save made from here.
        serviceTimes: v.serviceTimes.map((row) => {
          const existing = form.serviceTimes.find((s) => s.id && s.id === row.id);
          return {
            ...(existing ?? {
              clientId: row.clientId,
              endTime: "",
              kind: "regular" as const,
              notes: "",
            }),
            id: row.id,
            clientId: row.clientId,
            label: row.label,
            dayOfWeek: row.dayOfWeek,
            startTime: row.startTime,
          };
        }),
        staff: v.staff.map((row) => {
          const existing = form.staff.find((s) => s.id && s.id === row.id);
          return {
            ...(existing ?? {
              clientId: row.clientId,
              email: "",
              phone: "",
              isSeniorPastor: false,
              isExecutivePastor: false,
              aiContactPriority: 0,
            }),
            id: row.id,
            clientId: row.clientId,
            fullName: row.fullName,
            title: row.title,
            bio: row.bio,
            photoUrl: row.photoUrl,
            isPublic: row.isPublic,
          };
        }),
      },
      admin,
    );
  } catch (error) {
    console.error("[website] details save failed:", error);
    return fail("Those details could not be saved.");
  }

  refresh();
  revalidatePath("/dashboard/church-profile");
  return ok;
}

// ---------------------------------------------------------------------------
// MESSAGES
// ---------------------------------------------------------------------------

/** Any member who can see the section may triage the inbox, not just admins. */
export async function setSubmissionStatus(
  id: string,
  status: "new" | "read" | "archived",
): Promise<ActionResult> {
  const auth = await guard();
  if (!auth.ok) return fail(auth.error);

  if (!(await ownsRow("site_contact_submissions", id, auth.churchId))) {
    return fail("That message does not belong to your church.");
  }

  const { error } = await createAdminClient()
    .from("site_contact_submissions")
    .update({ status })
    .eq("id", id);

  if (error) return fail("That message could not be updated.");

  revalidatePath("/dashboard/website/messages");
  return ok;
}

// ---------------------------------------------------------------------------

async function slugFor(churchId: string): Promise<string> {
  const { data } = await createAdminClient()
    .from("churches")
    .select("slug")
    .eq("id", churchId)
    .maybeSingle();

  return (data?.slug as string | null) ?? "";
}
