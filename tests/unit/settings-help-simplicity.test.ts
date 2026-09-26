import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  deriveTicketSubject,
  sanitizeFromPath,
  supportTicketStatus,
  withFromPath,
  SUPPORT_RESPONSE_TIME,
} from "@/app/dashboard/support/ticket-helpers";
import { HELP_ANSWERS, helpAnswersFor } from "@/app/dashboard/support/help-content";
import { mergeChurchBasics, pickChurchBasics } from "@/components/settings/church-basics";
import {
  describeAccountError,
  readAccountNotice,
} from "@/components/settings/connected-accounts-messages";
import {
  REMOVED_SETTINGS_TABS,
  resolveSettingsTab,
  visibleSettingsTabs,
  SETTINGS_TABS,
} from "@/components/settings/settings-tabs-config";
import {
  TEAM_PRESETS,
  defaultPresetId,
  isPresetAvailable,
  matchPreset,
  presetFeatures,
  roleLabel,
} from "@/components/settings/team-presets";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/features/catalog";
import type { ChurchAppInfo } from "@/lib/queries/church-app-info";

const read = (path: string) => readFileSync(path, "utf8");
const params = (query: string) => new URLSearchParams(query);
const ALL: FeatureKey[] = [...FEATURE_KEYS];
const ADMIN_TABS = visibleSettingsTabs({ isAdmin: true, allowedFeatures: ALL });

// ---------------------------------------------------------------------------
// Settings sections and deep links
// ---------------------------------------------------------------------------

test("settings has five plain sections, in the order a church thinks about them", () => {
  assert.deepEqual(
    SETTINGS_TABS.map((tab) => tab.label),
    ["Church info", "Your Team", "Connected accounts", "Messages & email", "Member App"],
  );
  assert.deepEqual(ADMIN_TABS, ["church", "team", "accounts", "messages", "app"]);
});

test("the Advanced section is gone and its old link goes to Settings home", () => {
  assert.ok(!(ADMIN_TABS as readonly string[]).includes("advanced"));
  assert.ok(REMOVED_SETTINGS_TABS.includes("advanced"));
  assert.equal(resolveSettingsTab(params("tab=advanced"), ADMIN_TABS), "church");
  const page = read("app/dashboard/settings/page.tsx");
  assert.match(page, /REMOVED_SETTINGS_TABS\.includes/);
  assert.match(page, /redirect\("\/dashboard\/settings"\)/);
  const panels = read("app/dashboard/settings/tab-panels.tsx");
  assert.doesNotMatch(panels, /AdvancedPanel|Light or dark/);
  // Apple Mail drafts now live with the connected accounts.
  const accounts = panels.slice(panels.indexOf("async function AccountsPanel"), panels.indexOf("async function MessagesPanel"));
  assert.match(accounts, /Apple Mail drafts/);
  assert.match(accounts, /<AppleMailDraftsCard/);
});

test("light or dark is three labelled icon buttons at the top of every section", () => {
  const header = read("components/settings/settings-skeletons.tsx");
  assert.match(header, /secondary=\{<ThemeToggle variant="icons" \/>\}/);
  const toggle = read("components/theme-toggle.tsx");
  const icons = toggle.slice(toggle.indexOf('variant === "icons"'));
  assert.match(icons, /aria-label=\{label\}/);
  assert.match(icons, /title=/);
  assert.match(icons, /aria-checked=\{active\}/);
  assert.match(icons, /size-11/);
  assert.match(toggle, /label: "Match my computer"/);
});

test("app colors live in the Member App section, spelled the American way", () => {
  const panels = read("app/dashboard/settings/tab-panels.tsx");
  const church = panels.slice(panels.indexOf("async function ChurchInfoPanel"), panels.indexOf("async function MemberAppPanel"));
  assert.doesNotMatch(church, /BrandColorsCard/);
  assert.match(panels.slice(panels.indexOf("async function MemberAppPanel")), /<BrandColorsCard/);
  const card = read("components/settings/brand-colors-card.tsx");
  assert.match(card, /<CardTitle>App colors<\/CardTitle>/);
  assert.doesNotMatch(card, /colour/i);
  assert.ok(!visibleSettingsTabs({ isAdmin: false, allowedFeatures: ALL }).includes("app"));
  assert.ok(!visibleSettingsTabs({ isAdmin: true, allowedFeatures: ["people"] }).includes("app"));
});

test("church info: service times come before the address, the small logo is last", () => {
  const form = read("components/settings/church-info-card.tsx");
  const details = form.slice(form.indexOf("export function ChurchDetailsForm"));
  assert.ok(details.indexOf("Service times") < details.indexOf("Street address"), "service times first");
  assert.match(form, /kind === "logo" \? "size-16"/);
  const panels = read("app/dashboard/settings/tab-panels.tsx");
  assert.ok(panels.indexOf("<ChurchDetailsForm") < panels.indexOf("<ChurchImagesCard"), "images last");
  const skeleton = read("components/settings/settings-skeletons.tsx");
  const church = skeleton.slice(skeleton.indexOf("function ChurchInfoSkeleton"), skeleton.indexOf("function MemberAppSkeleton"));
  assert.ok(church.indexOf("Service times") < church.indexOf("Street address"));
  assert.ok(church.indexOf("Street address") < church.indexOf("Logo and cover photo"));
});

test("each follow-up message adds [Name] from a small button in its header", () => {
  const form = read("components/settings/follow-up-messages-form.tsx");
  assert.doesNotMatch(form, /PlaceholderChips|Tap to add it:/);
  assert.match(form, /insertPlaceholder\(id, NAME_TOKEN\)/);
  assert.match(form, /aria-label=\{`Add their first name/);
  assert.match(form, /\{!hasName && \(/);
});

test("old ?tab= links keep landing on the section that now holds them", () => {
  const cases: Array<[string, string]> = [
    ["tab=general", "church"],
    ["tab=integrations", "accounts"],
    ["tab=communications", "messages"],
    ["tab=attendance", "messages"],
    ["tab=team", "team"],
    ["tab=accounts", "accounts"],
    ["", "church"],
    ["tab=nonsense", "church"],
  ];
  for (const [query, expected] of cases) {
    assert.equal(resolveSettingsTab(params(query), ADMIN_TABS, { givingAvailable: true }), expected, query);
  }
});

test("an OAuth or Stripe round trip opens the section that shows its result", () => {
  for (const key of ["google_connected=1", "facebook_connected=1", "youtube_connected=1", "integration_error=access_denied"]) {
    assert.equal(resolveSettingsTab(params(key), ADMIN_TABS), "accounts", key);
  }
  assert.equal(resolveSettingsTab(params("tab=giving&stripe_return=1"), ADMIN_TABS, { givingAvailable: true }), "giving");
  assert.equal(resolveSettingsTab(params("tab=giving"), ADMIN_TABS, { givingAvailable: true }), "giving");
  // Without Giving, the old link falls back instead of showing a dead end.
  assert.equal(resolveSettingsTab(params("tab=giving"), ADMIN_TABS, { givingAvailable: false }), "church");
});

test("non-admins only see sections they can use", () => {
  const tabs = visibleSettingsTabs({ isAdmin: false, allowedFeatures: ALL });
  assert.deepEqual(tabs, ["church", "team"]);
  assert.equal(resolveSettingsTab(params("tab=integrations"), tabs), "church");
  assert.equal(resolveSettingsTab(params("google_connected=1"), tabs), "church");
  // Messages needs Announcements or Attendance, even for an admin.
  assert.ok(!visibleSettingsTabs({ isAdmin: true, allowedFeatures: ["people"] }).includes("messages"));
});

// ---------------------------------------------------------------------------
// Team presets map onto role + feature_permissions without new authority
// ---------------------------------------------------------------------------

test("presets are Admin, Staff and Volunteer, and map to the existing role model", () => {
  assert.deepEqual(TEAM_PRESETS.map((preset) => preset.label), ["Admin", "Staff", "Volunteer"]);
  const admin = TEAM_PRESETS.find((preset) => preset.id === "admin")!;
  const volunteer = TEAM_PRESETS.find((preset) => preset.id === "volunteer")!;
  const staff = TEAM_PRESETS.find((preset) => preset.id === "staff")!;
  assert.equal(admin.role, "admin");
  assert.deepEqual(presetFeatures(admin, ALL), []);
  assert.equal(volunteer.role, "viewer");
  assert.deepEqual(presetFeatures(volunteer, ALL), ["attendance", "checkin"]);
  assert.equal(staff.role, "viewer");
  // Staff never quietly includes money or pastor-only follow-up.
  assert.ok(!presetFeatures(staff, ALL).includes("giving"));
  assert.ok(!presetFeatures(staff, ALL).includes("attendance_follow_up"));
});

test("a preset never grants a feature the account has switched off", () => {
  const volunteer = TEAM_PRESETS.find((preset) => preset.id === "volunteer")!;
  assert.deepEqual(presetFeatures(volunteer, ["checkin", "people"]), ["checkin"]);
  assert.equal(isPresetAvailable(volunteer, ["people"]), false);
});

test("the invite never starts in the 'no features' error state", () => {
  const accounts: FeatureKey[][] = [ALL, ["people"], [], ["attendance"], ["giving", "website"]];
  for (const available of accounts) {
    const id = defaultPresetId(available);
    const preset = TEAM_PRESETS.find((entry) => entry.id === id)!;
    assert.ok(
      preset.role === "admin" || presetFeatures(preset, available).length > 0,
      `default for ${available.join(",") || "nothing"} grants something`,
    );
  }
  assert.equal(defaultPresetId(ALL), "volunteer");
  assert.equal(defaultPresetId([]), "admin");
});

test("existing access is recognised as a preset, or shown as custom", () => {
  assert.equal(matchPreset("admin", [], ALL), "admin");
  assert.equal(matchPreset("viewer", ["checkin", "attendance"], ALL), "volunteer");
  assert.equal(matchPreset("viewer", ["giving"], ALL), null);
  assert.equal(matchPreset("viewer", [], ALL), null);
  assert.equal(roleLabel("admin"), "Admin");
  assert.equal(roleLabel("viewer"), "Team member");
});

test("team actions keep their guards and never show raw errors", () => {
  const actions = read("app/dashboard/settings/team-actions.ts");
  for (const name of ["inviteTeamMember", "resetTeamMemberPassword", "updateTeamMemberAccess", "removeTeamMember"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    const end = body.indexOf("\nexport async function", 10);
    const fn = end === -1 ? body : body.slice(0, end);
    assert.match(fn, /requireChurchAdminContext\(\)/, `${name} still checks for a church admin`);
    assert.match(fn, /\.eq\("church_id", churchId\)|church_id: churchId/, `${name} stays scoped to the church`);
  }
  assert.match(actions, /sanitizeFeatureGrants/);
  assert.match(actions, /countChurchAdmins/);
  assert.doesNotMatch(actions, /error: \w+(Error)?\.message/);
  assert.doesNotMatch(actions, /service role key/);
  assert.match(actions, /toUserError/);
});

test("team rows have labelled buttons and removal still asks first", () => {
  const card = read("components/settings/team-members-card.tsx");
  assert.match(card, /Change access/);
  assert.match(card, /Remove from team/);
  assert.match(card, /confirmAction\(/);
  assert.match(card, /Invite someone/);
  assert.match(card, /Choose tools one by one/);
  assert.doesNotMatch(card, /MoreHorizontal/);
  assert.match(card, /Copy password/);
  assert.match(card, /You won&apos;t see it again/);
});

// ---------------------------------------------------------------------------
// Connected accounts
// ---------------------------------------------------------------------------

test("OAuth error codes become sentences, never the raw code", () => {
  for (const code of ["missing_code", "invalid_state", "access_denied", "session_mismatch", "Error: invalid_grant at token endpoint"]) {
    const message = describeAccountError(code);
    assert.ok(!message.includes(code), `${code} leaks`);
    assert.match(message, /\.$/);
  }
  assert.match(describeAccountError("access_denied"), /permission/);
});

test("a result is shown beside the account it belongs to", () => {
  assert.deepEqual(readAccountNotice(params("tab=accounts&account=facebook&integration_error=missing_code")), {
    kind: "error",
    message: describeAccountError("missing_code"),
    account: "facebook",
  });
  assert.equal(readAccountNotice(params("google_connected=1"))?.account, "google");
  assert.equal(readAccountNotice(params("integration_error=x"))?.account, null);
  assert.equal(readAccountNotice(params("tab=accounts")), null);
});

test("connected accounts: one Google row, no relay, confirmed disconnects", () => {
  const card = read("components/settings/connected-accounts-card.tsx");
  assert.match(card, /Google: Calendar and Gmail/);
  assert.doesNotMatch(card, /Google email/);
  assert.doesNotMatch(card, /relay|RTMP/i);
  assert.match(card, /confirmAction\(/);
  const apple = read("components/settings/apple-calendar-connect.tsx");
  assert.match(apple, /Other ways to connect/);
  for (const dir of ["components/settings", "components/support"]) {
    for (const file of readdirSync(dir)) {
      const source = read(`${dir}/${file}`);
      assert.doesNotMatch(source, /window\.confirm\(|[^.\w]confirm\(`/, `${dir}/${file} uses a browser confirm`);
    }
  }
});

test("Reset to defaults asks before replacing a church's wording", () => {
  const reset = read("components/settings/confirm-reset-button.tsx");
  assert.match(reset, /confirmAction\(/);
  assert.match(reset, /name="reset"/);
  for (const file of ["components/settings/announcement-email-form.tsx", "components/settings/follow-up-messages-form.tsx"]) {
    assert.match(read(file), /<ConfirmResetButton/, file);
  }
});

// ---------------------------------------------------------------------------
// Church info reuses the one source of truth
// ---------------------------------------------------------------------------

test("saving church basics never touches the rest of the church page", () => {
  const current: ChurchAppInfo = {
    name: "Grace",
    tagline: "A church for the city",
    about: "About us",
    logoUrl: "https://x/logo.png",
    coverImageUrl: "https://x/cover.png",
    address: "1 Main",
    city: "Town",
    state: "TX",
    zip: "75001",
    phone: "555",
    email: "a@b.org",
    website: "https://grace.church",
    mapsUrl: "",
    social: { instagram: "https://instagram.com/grace", facebook: "", youtube: "", tiktok: "", x: "", podcast: "" },
    quickLinks: [{ clientId: "link-0", label: "Serve", url: "https://grace.church/serve" }],
    serviceTimes: [{ clientId: "s1", id: "s1", label: "Sunday", dayOfWeek: 0, startTime: "10:00" }],
  };
  const edited = { ...pickChurchBasics(current), address: "2 Oak", name: "Grace Church" };
  const merged = mergeChurchBasics(current, edited);
  assert.equal(merged.address, "2 Oak");
  assert.equal(merged.name, "Grace Church");
  assert.equal(merged.tagline, current.tagline);
  assert.equal(merged.logoUrl, current.logoUrl);
  assert.deepEqual(merged.social, current.social);
  assert.deepEqual(merged.quickLinks, current.quickLinks);

  const action = read("app/dashboard/settings/church-info-actions.ts");
  assert.match(action, /saveChurchAppInfo\(merged\)/);
  assert.match(action, /getChurchAppInfo\(auth\.churchId\)/);
  assert.match(action, /auth\.isAdmin/);
});

test("settings and help pages use the shell width and plain skeletons", () => {
  for (const file of [
    "app/dashboard/settings/page.tsx",
    "app/dashboard/settings/loading.tsx",
    "app/dashboard/support/page.tsx",
    "app/dashboard/support/loading.tsx",
  ]) {
    assert.doesNotMatch(read(file), /max-w-(lg|xl|2xl|3xl|4xl|5xl|6xl)\b[^"]*"\s*>\s*$/m, file);
    assert.doesNotMatch(read(file), /mx-auto flex w-full max-w-/, file);
  }
  assert.match(read("app/dashboard/settings/loading.tsx"), /SkeletonContainer/);
  assert.match(read("app/dashboard/support/loading.tsx"), /SkeletonContainer/);
});

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

test("a message without a subject takes its first line", () => {
  assert.equal(deriveTicketSubject("", "\n  Can't find the giving page \nMore detail"), "Can't find the giving page");
  assert.equal(deriveTicketSubject("  Billing  ", "Body"), "Billing");
  assert.equal(deriveTicketSubject("", ""), "");
  const long = deriveTicketSubject("", "word ".repeat(40));
  assert.ok(long.length <= 80, long);
  assert.match(long, /…$/);
});

test("only a dashboard path is kept as 'the page they came from'", () => {
  assert.equal(sanitizeFromPath("/dashboard/giving?x=1"), "/dashboard/giving");
  assert.equal(sanitizeFromPath("https://evil.example/dashboard"), null);
  assert.equal(sanitizeFromPath("//evil.example"), null);
  assert.equal(sanitizeFromPath("/admin"), null);
  assert.equal(sanitizeFromPath("/dashboard/support"), null);
  assert.equal(sanitizeFromPath("/dashboard/people/<script>"), null);
  assert.equal(withFromPath("Help", "/dashboard/giving"), "Help\n\n(Sent from /dashboard/giving)");
  assert.equal(withFromPath("Help", null), "Help");
});

test("ticket statuses read We're on it, Answered or Closed", () => {
  assert.equal(supportTicketStatus({ status: "open", comments: [] }).label, "We're on it");
  assert.equal(supportTicketStatus({ status: "in_progress", comments: [{ authorRole: "church" }] }).label, "We're on it");
  assert.equal(supportTicketStatus({ status: "open", comments: [{ authorRole: "platform" }] }).label, "Answered");
  assert.equal(supportTicketStatus({ status: "resolved", comments: [{ authorRole: "platform" }] }).label, "Closed");
  const list = read("components/support/support-tickets-list.tsx");
  assert.doesNotMatch(list, /components\/admin\/badges/);
});

test("the Help page promises the same response time as the public support page", () => {
  assert.match(read("app/support/page.tsx"), new RegExp(SUPPORT_RESPONSE_TIME.replace("within ", "")));
  const page = read("app/dashboard/support/page.tsx");
  assert.doesNotMatch(page, /one business day/);
  assert.doesNotMatch(page, /tel:/, "no invented phone number");
  assert.match(SUPPORT_RESPONSE_TIME, /same day/);
  assert.doesNotMatch(read("app/support/page.tsx"), /business day/);
});

test("common questions sit at the bottom of the Help page and its skeleton", () => {
  const page = read("app/dashboard/support/page.tsx");
  assert.ok(page.indexOf('id="answers"') > page.indexOf('id="tickets-heading"'), "answers come after Your messages");
  const loading = read("app/dashboard/support/loading.tsx");
  assert.ok(
    loading.indexOf('<SectionHeader title="Common questions"') > loading.indexOf('title="Your messages"'),
    "skeleton mirrors the order",
  );
});

test("common answers cover the top tasks and hide pages you can't open", () => {
  assert.deepEqual(
    HELP_ANSWERS.map((answer) => answer.feature),
    ["people", "live_stream", "checkin", "announcements", "giving"],
  );
  assert.deepEqual(helpAnswersFor(["people"]).map((answer) => answer.id), ["add-person"]);
});

test("the ticket form sends one message box and a Send message button", () => {
  const form = read("components/support/support-ticket-form.tsx");
  assert.match(form, /Send message/);
  assert.match(form, /fromPath/);
  const actions = read("app/dashboard/support/actions.ts");
  assert.match(actions, /deriveTicketSubject/);
  assert.match(actions, /requireChurchAuth\(\)/);
  assert.doesNotMatch(actions, /error: error\.message/);
});
