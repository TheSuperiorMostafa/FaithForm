import { FEATURES, type FeatureKey } from "@/lib/features/catalog";
import type { TeamRole } from "@/lib/queries/team";

/**
 * Three ready-made kinds of access, so inviting someone is one choice instead
 * of thirteen checkboxes.
 *
 * They are only shortcuts onto the existing model: Admin is `role: "admin"`
 * (every feature, implicitly), and Staff / Volunteer are `role: "viewer"` with
 * a list of feature grants. The server still intersects every grant with what
 * the account has switched on, so a preset can never hand out more than the
 * checkbox grid could.
 */
export type TeamPresetId = "admin" | "staff" | "volunteer";

export type TeamPreset = {
  id: TeamPresetId;
  label: string;
  description: string;
  role: TeamRole;
  /** Wanted grants for a viewer preset, before intersecting with the account. */
  wants: readonly FeatureKey[];
};

/** The tools most staff use week to week. Money, pastoral follow-up and the
 *  church's public presence stay with admins unless chosen one by one. */
export const STAFF_FEATURES: readonly FeatureKey[] = [
  "people",
  "groups",
  "attendance",
  "checkin",
  "announcements",
  "sermon_builder",
  "live_stream",
  "library",
];

export const VOLUNTEER_FEATURES: readonly FeatureKey[] = ["attendance", "checkin"];

export const TEAM_PRESETS: readonly TeamPreset[] = [
  {
    id: "admin",
    label: "Admin",
    description: "Everything, including Settings, Giving and the team.",
    role: "admin",
    wants: [],
  },
  {
    id: "staff",
    label: "Staff",
    description: "The everyday tools.",
    role: "viewer",
    wants: STAFF_FEATURES,
  },
  {
    id: "volunteer",
    label: "Volunteer",
    description: "Attendance and Kids Check-in only.",
    role: "viewer",
    wants: VOLUNTEER_FEATURES,
  },
];

/** Keeps catalog order so the same set always looks the same. */
function inCatalogOrder(keys: readonly FeatureKey[]): FeatureKey[] {
  const set = new Set(keys);
  return FEATURES.map((feature) => feature.key).filter((key) => set.has(key));
}

/** The grants a preset gives on this account. Empty for Admin. */
export function presetFeatures(
  preset: TeamPreset,
  availableFeatures: readonly FeatureKey[],
): FeatureKey[] {
  if (preset.role === "admin") return [];
  const available = new Set(availableFeatures);
  return inCatalogOrder(preset.wants.filter((key) => available.has(key)));
}

/**
 * A viewer preset that would grant nothing on this account is not offered:
 * choosing it could only end in "give them at least one feature".
 */
export function isPresetAvailable(
  preset: TeamPreset,
  availableFeatures: readonly FeatureKey[],
): boolean {
  return preset.role === "admin" || presetFeatures(preset, availableFeatures).length > 0;
}

/**
 * The preset an invite starts on: the least access that still works, so
 * nobody gets more than they need by accident and the form is never in the
 * "no features" error state before anyone has touched it.
 */
export function defaultPresetId(availableFeatures: readonly FeatureKey[]): TeamPresetId {
  for (const id of ["volunteer", "staff"] as const) {
    const preset = TEAM_PRESETS.find((entry) => entry.id === id)!;
    if (isPresetAvailable(preset, availableFeatures)) return id;
  }
  return "admin";
}

/** Which preset a role + grant list is exactly, or null when it is custom. */
export function matchPreset(
  role: TeamRole,
  features: readonly FeatureKey[],
  availableFeatures: readonly FeatureKey[],
): TeamPresetId | null {
  if (role === "admin") return "admin";
  const chosen = inCatalogOrder(features).join(",");
  if (!chosen) return null;
  for (const preset of TEAM_PRESETS) {
    if (preset.role !== "viewer") continue;
    if (!isPresetAvailable(preset, availableFeatures)) continue;
    if (presetFeatures(preset, availableFeatures).join(",") === chosen) return preset.id;
  }
  return null;
}

/** "Admin" or "Team member": the only two words a pastor needs for roles. */
export function roleLabel(role: TeamRole): string {
  return role === "admin" ? "Admin" : "Team member";
}
