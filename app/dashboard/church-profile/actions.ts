"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireChurchAuth } from "@/lib/auth/church";
import { normalizeHexColor } from "@/lib/giving/branding";
import { syncRetellAgent } from "@/lib/integrations/retell";
import {
  getChurchProfile,
  upsertChurchProfile,
  type UpsertChurchProfileInput,
} from "@/lib/queries/church-profile";
import { validateImageBuffer } from "@/lib/security/validate-image";
import { createAdminClient } from "@/lib/supabase/admin";
import { SERVICE_TIME_KINDS } from "@/types/church-profile";

const dayHoursSchema = z.object({
  enabled: z.boolean(),
  open: z.string(),
  close: z.string(),
});

const officeHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
});

const serviceTimeSchema = z.object({
  clientId: z.string(),
  id: z.string().optional(),
  label: z.string().trim().min(1).max(120),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string(),
  kind: z.enum(SERVICE_TIME_KINDS),
  notes: z.string().max(500),
});

const staffSchema = z.object({
  clientId: z.string(),
  id: z.string().optional(),
  fullName: z.string().trim().min(1).max(120),
  title: z.string().max(120),
  email: z.string().max(120),
  phone: z.string().max(30),
  photoUrl: z.string().max(500),
  bio: z.string().max(2000),
  isSeniorPastor: z.boolean(),
  isExecutivePastor: z.boolean(),
  aiContactPriority: z.number().int().min(0).max(100),
  isPublic: z.boolean(),
});

const saveSchema = z
  .object({
    name: z.string().trim().min(2, "Church name is required").max(120),
    tagline: z.string().max(200),
    missionStatement: z.string().max(2000),
    visionStatement: z.string().max(2000),
    description: z.string().max(4000),
    logoUrl: z.string().max(500),
    coverImageUrl: z.string().max(500),
    primaryColor: z.string().max(20),
    accentColor: z.string().max(20),
    address: z.string().max(200),
    city: z.string().max(80),
    state: z.string().max(40),
    zip: z.string().max(20),
    phone: z.string().max(30),
    email: z.string().max(120),
    website: z.string().max(200),
    googleMapsUrl: z.string().max(500),
    timezone: z.string().min(1).max(80),
    denomination: z.string().trim().min(1, "Denomination is required").max(80),
    officeHours: officeHoursSchema,
    holidaySchedule: z.string().max(2000),
    facebookUrl: z.string().max(500),
    instagramUrl: z.string().max(500),
    youtubeUrl: z.string().max(500),
    tiktokUrl: z.string().max(500),
    xUrl: z.string().max(500),
    podcastUrl: z.string().max(500),
    livestreamUrl: z.string().max(500),
    aiKnowledge: z.record(z.string(), z.string()),
    serviceTimes: z.array(serviceTimeSchema),
    staff: z.array(staffSchema),
  })
  .superRefine((data, ctx) => {
    const hasOpenDay = Object.values(data.officeHours).some((d) => d.enabled);
    if (!hasOpenDay) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enable at least one office day",
        path: ["officeHours"],
      });
    }

    if (data.phone.trim() && data.phone.replace(/\D/g, "").length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid phone number",
        path: ["phone"],
      });
    }

    if (data.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid email address",
        path: ["email"],
      });
    }
  });

export type SaveChurchProfileResult =
  | { ok: true }
  | { error: string };

export async function saveChurchProfile(
  input: UpsertChurchProfileInput,
): Promise<SaveChurchProfileResult> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) {
    return { error: "Only church admins can update the church profile." };
  }

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Invalid profile data." };
  }

  const primary = normalizeHexColor(parsed.data.primaryColor);
  const accent = normalizeHexColor(parsed.data.accentColor);
  if (parsed.data.primaryColor.trim() && !primary) {
    return { error: "Primary color must be a valid hex value (e.g. #1A2B4B)." };
  }
  if (parsed.data.accentColor.trim() && !accent) {
    return { error: "Accent color must be a valid hex value (e.g. #C19A6B)." };
  }

  try {
    const admin = createAdminClient();
    await upsertChurchProfile(auth.churchId, {
      ...parsed.data,
      primaryColor: primary ?? "",
      accentColor: accent ?? "",
    }, admin);

    try {
      await syncRetellAgent(auth.churchId);
    } catch (syncError) {
      console.error("Church profile saved but Retell sync failed:", syncError);
    }

    revalidatePath("/dashboard/church-profile");
    revalidatePath("/dashboard/voice-assistant");
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/giving");
    return { ok: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save church profile.",
    };
  }
}

export async function uploadChurchProfileLogo(
  formData: FormData,
): Promise<{ ok: true; logoUrl: string } | { error: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Forbidden" };

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) return { error: "No file provided." };
  if (file.size > 2 * 1024 * 1024) return { error: "Logo must be 2MB or smaller." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const validated = await validateImageBuffer(buffer);
  if (!validated) return { error: "Logo must be a valid PNG or JPG image." };

  const path = `${auth.churchId}/logo.${validated.ext}`;
  const admin = createAdminClient();

  const { error: uploadError } = await admin.storage
    .from("church-logos")
    .upload(path, validated.buffer, {
      contentType: validated.contentType,
      upsert: true,
    });

  if (uploadError) return { error: uploadError.message };

  const { data: publicUrl } = admin.storage.from("church-logos").getPublicUrl(path);
  const logoUrl = publicUrl.publicUrl;

  const { error } = await admin
    .from("churches")
    .update({ logo_url: logoUrl })
    .eq("id", auth.churchId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/church-profile");
  revalidatePath("/dashboard/giving");
  return { ok: true, logoUrl };
}

export async function uploadChurchCoverImage(
  formData: FormData,
): Promise<{ ok: true; coverUrl: string } | { error: string }> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) return { error: "Forbidden" };

  const file = formData.get("cover") as File | null;
  if (!file || file.size === 0) return { error: "No file provided." };
  if (file.size > 5 * 1024 * 1024) return { error: "Cover image must be 5MB or smaller." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const validated = await validateImageBuffer(buffer);
  if (!validated) return { error: "Cover must be a valid PNG or JPG image." };

  const path = `${auth.churchId}/cover.${validated.ext}`;
  const admin = createAdminClient();

  const { error: uploadError } = await admin.storage
    .from("church-covers")
    .upload(path, validated.buffer, {
      contentType: validated.contentType,
      upsert: true,
    });

  if (uploadError) return { error: uploadError.message };

  const { data: publicUrl } = admin.storage.from("church-covers").getPublicUrl(path);
  const coverUrl = publicUrl.publicUrl;

  const { error } = await admin
    .from("churches")
    .update({ cover_image_url: coverUrl })
    .eq("id", auth.churchId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/church-profile");
  return { ok: true, coverUrl };
}

export async function loadChurchProfileForPage(churchId: string) {
  const admin = createAdminClient();
  return getChurchProfile(churchId, admin);
}
