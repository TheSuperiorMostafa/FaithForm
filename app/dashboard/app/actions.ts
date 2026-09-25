"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { UploadResult } from "@/app/dashboard/website/actions";
import { syncChurchOccurrencesAfterChange } from "@/lib/attendance/v2/occurrences";
import { normalizeSiteImage } from "@/lib/security/validate-image";
import { getAspect, type ImageAspectKey } from "@/lib/sites/image-aspects";
import { getChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import {
  MAX_QUICK_LINKS,
  MAX_QUICK_LINK_LABEL,
  SOCIAL_PLATFORMS,
  normalizeSocialUrl,
  normalizeWebUrl,
} from "@/lib/faithform/church-links";
import { bumpPublicProfileVersion } from "@/lib/faithform/discovery";
import { getChurchAppInfo, type ChurchAppInfo } from "@/lib/queries/church-app-info";
import {
  getChurchProfile,
  profileToFormState,
  upsertChurchProfile,
} from "@/lib/queries/church-profile";
import { createAdminClient } from "@/lib/supabase/admin";

const serviceTimeRow = z.object({
  clientId: z.string(),
  id: z.string().optional(),
  label: z.string().trim().max(120),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Use a time like 10:30."),
});

const schema = z.object({
  name: z.string().trim().min(1, "Your church name is required.").max(200),
  tagline: z.string().max(200),
  about: z.string().max(2000),
  logoUrl: z.string().max(500),
  coverImageUrl: z.string().max(500),
  address: z.string().max(200),
  city: z.string().max(120),
  state: z.string().max(60),
  zip: z.string().max(20),
  phone: z.string().max(40),
  email: z.string().max(200),
  website: z.string().max(500),
  mapsUrl: z.string().max(500),
  social: z.record(z.string(), z.string().max(500)),
  quickLinks: z
    .array(
      z.object({
        clientId: z.string(),
        label: z.string().max(MAX_QUICK_LINK_LABEL),
        url: z.string().max(500),
      }),
    )
    .max(MAX_QUICK_LINKS, `Up to ${MAX_QUICK_LINKS} links.`),
  serviceTimes: z.array(serviceTimeRow).max(20),
});

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * The church page's logo and cover.
 *
 * Same validation, cropping and bucket as the website's upload, but gated on
 * being a church admin rather than on the Website feature: a church can have
 * the member app without having a website.
 */
export async function uploadChurchAppImage(formData: FormData): Promise<UploadResult> {
  const auth = await getChurchAuth();
  if (!auth?.churchId) return { ok: false, error: "You are not signed in." };
  if (!auth.isAdmin) return { ok: false, error: "Only church admins can change images." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That image is over 12MB. Please pick a smaller one." };
  }

  const aspect = getAspect((formData.get("aspect") as ImageAspectKey | null) ?? undefined);
  const num = (key: string) => {
    const raw = formData.get(key);
    const parsed = typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  const [x, y, width, height] = ["cropX", "cropY", "cropWidth", "cropHeight"].map(num);
  const crop =
    x !== null && y !== null && width !== null && height !== null
      ? { x, y, width, height }
      : null;

  const normalized = await normalizeSiteImage(Buffer.from(await file.arrayBuffer()), {
    crop,
    output: crop ? aspect.output : null,
  });
  if (!normalized) {
    return {
      ok: false,
      error: "That file doesn't look like an image we can use. Try a JPG, PNG, or HEIC photo.",
    };
  }

  const path = `${auth.churchId}/app/${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${normalized.ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("church-covers")
    .upload(path, normalized.buffer, { contentType: normalized.contentType, upsert: false });
  if (error) {
    return { ok: false, error: toUserError(error, "That image could not be uploaded.") };
  }
  return { ok: true, url: admin.storage.from("church-covers").getPublicUrl(path).data.publicUrl };
}

export type SaveChurchAppInfoResult =
  | { ok: true; info: ChurchAppInfo }
  | { ok: false; error: string; field?: string };

function fail(error: string, field?: string): SaveChurchAppInfoResult {
  return { ok: false, error, field };
}

/**
 * Saves the church's page in the member app.
 *
 * Contact details, images and service times are the church profile — the
 * website and the phone assistant read the same rows — so they are merged into
 * the current profile rather than overwriting it: `upsertChurchProfile`
 * replaces the whole profile, and saving from here must not blank out office
 * hours, staff or AI knowledge. Every link is normalized on the way in, so the
 * phones only ever receive absolute http(s) URLs.
 */
export async function saveChurchAppInfo(input: ChurchAppInfo): Promise<SaveChurchAppInfoResult> {
  const auth = await getChurchAuth();
  if (!auth?.churchId) return fail("Sign in to your church to make changes.");
  if (!auth.isAdmin) return fail("Only church admins can change the church page.");

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(issue?.message ?? "Please check the form.", issue?.path.join("."));
  }
  const v = parsed.data;

  const email = v.email.trim();
  if (email && !z.email().safeParse(email).success) {
    return fail("That email address doesn't look right.", "email");
  }

  const website = v.website.trim() ? normalizeWebUrl(v.website) : "";
  if (website === null) return fail("Use a full web address, like grace.church.", "website");

  const mapsUrl = v.mapsUrl.trim() ? normalizeWebUrl(v.mapsUrl) : "";
  if (mapsUrl === null) return fail("Paste the full link from your maps app.", "mapsUrl");

  const social: Record<string, string> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const raw = v.social[platform.key]?.trim() ?? "";
    if (!raw) {
      social[platform.key] = "";
      continue;
    }
    const url = normalizeSocialUrl(platform.key, raw);
    if (!url) {
      return fail(
        platform.handleBase
          ? `Paste your ${platform.label} link or @handle.`
          : `Paste the full link to your ${platform.label.toLowerCase()}.`,
        `social.${platform.key}`,
      );
    }
    social[platform.key] = url;
  }

  const quickLinks: { label: string; url: string }[] = [];
  for (const [index, link] of v.quickLinks.entries()) {
    const label = link.label.trim();
    const rawUrl = link.url.trim();
    if (!label && !rawUrl) continue;
    if (!label) return fail("Give every link a name.", `quickLinks.${index}.label`);
    const url = normalizeWebUrl(rawUrl);
    if (!url) return fail(`"${label}" needs a full web address.`, `quickLinks.${index}.url`);
    quickLinks.push({ label, url });
  }

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
        tagline: v.tagline,
        description: v.about,
        logoUrl: v.logoUrl,
        coverImageUrl: v.coverImageUrl,
        address: v.address,
        city: v.city,
        state: v.state,
        zip: v.zip,
        phone: v.phone,
        email,
        website: website ?? "",
        googleMapsUrl: mapsUrl ?? "",
        instagramUrl: social.instagram,
        facebookUrl: social.facebook,
        youtubeUrl: social.youtube,
        tiktokUrl: social.tiktok,
        xUrl: social.x,
        podcastUrl: social.podcast,
        // Existing rows keep their id, so end time, kind, notes and a campus
        // link set elsewhere survive a save made from here.
        serviceTimes: v.serviceTimes
          .filter((row) => row.label.trim())
          .map((row) => {
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
      },
      admin,
    );
  } catch (error) {
    return fail(toUserError(error, "Those details could not be saved."));
  }

  const { error: linksError } = await admin
    .from("churches")
    .update({ app_links: quickLinks })
    .eq("id", auth.churchId);

  // Service times drive attendance too: a moved or deleted service must
  // replace its upcoming services rather than leave them standing.
  await syncChurchOccurrencesAfterChange(auth.churchId).catch((error) =>
    console.error("[member-app] occurrence sync failed:", error),
  );
  await bumpPublicProfileVersion(auth.churchId);

  revalidatePath("/dashboard/app");
  revalidatePath("/dashboard/website/details");

  if (linksError) {
    // 42703: `app_links` does not exist yet (the column arrives with a
    // database update). Everything else saved. `field` stays "quickLinks" —
    // Settings › Church info relies on that prefix to tell this apart.
    if (linksError.code === "42703") {
      return fail(
        "Links aren't available for your church yet. Everything else was saved.",
        "quickLinks",
      );
    }
    return fail(
      toUserError(linksError, "Everything was saved except your links."),
      "quickLinks",
    );
  }

  const saved = await getChurchAppInfo(auth.churchId);
  if (!saved) return fail("Saved, but the page could not be reloaded.");
  return { ok: true, info: saved.info };
}
