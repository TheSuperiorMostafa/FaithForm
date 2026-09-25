import type { FeatureKey } from "@/lib/features/catalog";

/**
 * The Settings sections, in the order a church thinks about them. Each one is
 * linkable as `/dashboard/settings?tab=<id>` so other pages can send people
 * straight to the right place.
 */
export const SETTINGS_TABS = [
  { id: "church", label: "Church info" },
  { id: "team", label: "Team" },
  { id: "accounts", label: "Connected accounts" },
  { id: "messages", label: "Messages & email" },
  { id: "advanced", label: "Advanced" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

/**
 * Giving is not a Settings section any more; `?tab=giving` still resolves so
 * old links and Stripe's return trip land somewhere that makes sense.
 */
export type ResolvedSettingsTab = SettingsTabId | "giving";

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "church";

/**
 * Tab names other pages (and older bookmarks) already link to. Each one maps
 * to the section that now holds the same controls.
 */
export const LEGACY_SETTINGS_TAB_ALIASES: Record<string, ResolvedSettingsTab> = {
  general: "church",
  integrations: "accounts",
  communications: "messages",
  attendance: "messages",
  giving: "giving",
};

/** Params the OAuth callbacks append when they come back to Settings. */
export const ACCOUNT_RESULT_PARAMS = [
  "google_connected",
  "facebook_connected",
  "youtube_connected",
  "apple_connected",
  "integration_error",
] as const;

type ParamReader = { get(name: string): string | null };

export type SettingsViewer = {
  isAdmin: boolean;
  /** Features this person can open (account switch AND their own access). */
  allowedFeatures: readonly FeatureKey[];
};

/**
 * Which sections this person can actually use. A non-admin never sees a tab
 * that would only tell them they can't change anything.
 */
export function visibleSettingsTabs(viewer: SettingsViewer): SettingsTabId[] {
  const allowed = new Set(viewer.allowedFeatures);
  return SETTINGS_TABS.map((tab) => tab.id).filter((id) => {
    if (id === "accounts") return viewer.isAdmin;
    if (id === "messages") {
      return viewer.isAdmin && (allowed.has("announcements") || allowed.has("attendance"));
    }
    return true;
  });
}

/**
 * Picks the section to show from the URL.
 *
 * Order matters: a Stripe or OAuth round trip wins over `tab`, because those
 * callbacks carry the result the person is waiting to see.
 */
export function resolveSettingsTab(
  params: ParamReader,
  visible: readonly SettingsTabId[],
  options: { givingAvailable?: boolean } = {},
): ResolvedSettingsTab {
  const givingAvailable = options.givingAvailable ?? false;

  if ((params.get("stripe_return") || params.get("stripe_refresh")) && givingAvailable) {
    return "giving";
  }

  if (ACCOUNT_RESULT_PARAMS.some((param) => params.get(param)) && visible.includes("accounts")) {
    return "accounts";
  }

  const raw = params.get("tab")?.trim().toLowerCase() ?? "";
  const tab = (LEGACY_SETTINGS_TAB_ALIASES[raw] ?? raw) as ResolvedSettingsTab;

  if (tab === "giving") return givingAvailable ? "giving" : DEFAULT_SETTINGS_TAB;
  if ((visible as readonly string[]).includes(tab)) return tab;
  return DEFAULT_SETTINGS_TAB;
}

export function settingsTabHref(tab: SettingsTabId): string {
  return tab === DEFAULT_SETTINGS_TAB ? "/dashboard/settings" : `/dashboard/settings?tab=${tab}`;
}

export const SETTINGS_PAGE_TITLE = "Settings";
export const SETTINGS_PAGE_DESCRIPTION =
  "Your church's details, your team, and the accounts FaithForm connects to.";
