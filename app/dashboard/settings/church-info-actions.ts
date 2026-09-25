"use server";

import { revalidatePath } from "next/cache";

import { saveChurchAppInfo } from "@/app/dashboard/app/actions";
import { getChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import {
  isChurchBasicsField,
  mergeChurchBasics,
  pickChurchBasics,
  type ChurchBasics,
} from "@/components/settings/church-basics";
import { getChurchAppInfo } from "@/lib/queries/church-app-info";

/**
 * The church's basic details, as edited from Settings › Church info.
 *
 * There is no second copy of any of this: it is the same church profile the
 * member app, the website and the phone assistant read, saved through the
 * very same action the App page uses (`saveChurchAppInfo`), which keeps its
 * own admin check, validation, service-time sync and cache busting.
 *
 * Settings only edits the basics, so the rest of the page (tagline, about,
 * social links, quick links, images) is re-read from the database at save
 * time and passed back untouched. Re-reading, rather than trusting what the
 * browser loaded, means a logo changed a moment ago is never overwritten.
 */
export type SaveChurchBasicsResult =
  | { ok: true; basics: ChurchBasics }
  | { ok: false; error: string; field?: string };

export async function saveChurchBasics(input: ChurchBasics): Promise<SaveChurchBasicsResult> {
  const auth = await getChurchAuth();
  if (!auth?.churchId) return { ok: false, error: "Sign in to your church to make changes." };
  if (!auth.isAdmin) return { ok: false, error: "Only church admins can change church details." };

  let current: Awaited<ReturnType<typeof getChurchAppInfo>>;
  try {
    current = await getChurchAppInfo(auth.churchId);
  } catch (error) {
    return { ok: false, error: toUserError(error, "We couldn't save your church details.") };
  }
  if (!current) {
    return { ok: false, error: toUserError(null, "We couldn't load your church details.") };
  }

  const merged = mergeChurchBasics(current.info, input);

  let result: Awaited<ReturnType<typeof saveChurchAppInfo>>;
  try {
    result = await saveChurchAppInfo(merged);
  } catch (error) {
    return { ok: false, error: toUserError(error, "We couldn't save your church details.") };
  }

  revalidatePath("/dashboard/settings");

  if (result.ok) return { ok: true, basics: pickChurchBasics(result.info) };

  // The App page's links live in a column some databases don't have yet. That
  // failure is reported after everything else has saved, and Settings never
  // touches links, so the details the person changed are in.
  // Checked against what is now stored, so a links problem that stopped the
  // save before it happened is never reported as saved.
  if (result.field?.startsWith("quickLinks")) {
    const saved = await getChurchAppInfo(auth.churchId).catch(() => null);
    const stored = saved ? pickChurchBasics(saved.info) : null;
    const landed =
      stored !== null &&
      (["name", "address", "city", "state", "zip", "phone", "email"] as const).every(
        (key) => stored[key].trim() === merged[key].trim(),
      );
    if (stored && landed) return { ok: true, basics: stored };
  }

  if (isChurchBasicsField(result.field) || !result.field) {
    return { ok: false, error: result.error, field: result.field };
  }
  return {
    ok: false,
    error:
      "We couldn't save your church details, because something else on your church page needs fixing first. Open the App page to check it.",
  };
}
