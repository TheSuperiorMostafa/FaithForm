import { createAdminClient } from "@/lib/supabase/admin";
import { getGivePageUrl } from "@/lib/stripe/config";
import {
  getChurchDashboardUsageSummary,
  getPlatformDashboardUsageTotals,
  getUserDashboardUsageByChurch,
} from "@/lib/queries/dashboard-usage";

export type AdminRole = "admin" | "viewer";
export type SupportTicketStatus = "open" | "in_progress" | "resolved";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

export type AuthUserSummary = {
  id: string;
  email: string | null;
  lastSignInAt: string | null;
};

export type AdminOverview = {
  stats: {
    totalChurches: number;
    totalUsers: number;
    totalSermons: number;
    platformHoursSaved: number;
    pastorMinutes30d: number;
    activeChurches30d: number;
  };
  integrationHealth: {
    totalChurches: number;
    googleConnected: number;
    facebookConnected: number;
  };
  recentTickets: AdminTicketListRow[];
  newChurchesThisMonth: AdminChurchSummary[];
};

export type AdminChurchSummary = {
  id: string;
  name: string;
  createdAt: string;
};

export type AdminChurchListRow = {
  id: string;
  name: string;
  usersCount: number;
  sermonsCount: number;
  googleConnected: boolean;
  facebookConnected: boolean;
  stripeOnboardingStatus: string;
  stripeChargesEnabled: boolean;
  onboardingCompletedAt: string | null;
  pendingInviteEmail: string | null;
  lastActiveAt: string | null;
  createdAt: string;
};

export type AdminChurchUserRow = {
  id: string;
  userId: string;
  email: string | null;
  role: AdminRole;
  joinedAt: string;
  dashboardSeconds7d: number;
  dashboardSeconds30d: number;
  lastSeenAt: string | null;
};

export type AdminChurchUsageSummary = {
  pastorSeconds7d: number;
  pastorSeconds30d: number;
  hoursSavedMinutes30d: number;
  phoneCalls30d: number;
};

export type AdminIntegrationDetail = {
  provider: "google" | "facebook";
  connected: boolean;
  accountLabel: string | null;
  tokenExpiresAt: string | null;
  updatedAt: string | null;
};

export type AdminAttendancePoint = {
  weekLabel: string;
  serviceDate: string;
  present: number;
};

export type AdminActivityRow = {
  id: string;
  type: string | null;
  category: string | null;
  task: string | null;
  timeSavedMinutes: number;
  createdAt: string;
};

export type AdminActivityRange = "7d" | "30d" | "90d" | "all";

export type AdminActivityFilters = {
  category?: string;
  type?: string;
  range?: AdminActivityRange;
  page?: number;
  pageSize?: number;
};

export type AdminActivityResult = {
  rows: AdminActivityRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filterOptions: {
    types: string[];
    categories: string[];
  };
};

export type AdminChurchDetail = {
  church: {
    id: string;
    name: string;
    timezone: string;
    slug: string;
    createdAt: string;
  };
  giving: {
    stripeOnboardingStatus: string;
    stripeChargesEnabled: boolean;
    stripePayoutsEnabled: boolean;
    stripeAccountId: string | null;
    stripeRequirementsDue: string[];
    givingEnabledAt: string | null;
    givePageUrl: string;
  };
  settings: {
    aiProvider: string | null;
    sermonBuilderMode: string | null;
    model: string | null;
    denomination: string | null;
    preachingStyle: string | null;
  } | null;
  attendanceTrend: AdminAttendancePoint[];
  users: AdminChurchUserRow[];
  integrations: AdminIntegrationDetail[];
  supportTickets: AdminTicketListRow[];
  usageSummary: AdminChurchUsageSummary;
};

export type AdminPlatformUserRow = {
  id: string;
  userId: string;
  email: string | null;
  churchId: string;
  churchName: string;
  role: AdminRole;
  lastSignInAt: string | null;
  joinedAt: string;
};

export type AdminTicketListRow = {
  id: string;
  subject: string;
  churchId: string | null;
  churchName: string | null;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  submittedBy: string | null;
  submittedByEmail: string | null;
  createdAt: string;
};

export type AdminTicketDetail = AdminTicketListRow & {
  body: string | null;
  adminNotes: string | null;
  updatedAt: string | null;
};

export type MonthPoint = {
  key: string;
  label: string;
  value: number;
};

export type NameValuePoint = {
  name: string;
  value: number;
};

export type AdminAnalytics = {
  churchesOverTime: MonthPoint[];
  hoursSavedPerMonth: MonthPoint[];
  aiModelUsage: NameValuePoint[];
  sermonGenerationByProvider: NameValuePoint[];
  automationActivityByType: NameValuePoint[];
};

type ChurchRow = {
  id: string;
  name: string;
  timezone?: string;
  created_at: string;
};

type ChurchUserRow = {
  id: string;
  church_id: string;
  user_id: string;
  role: string;
  created_at: string;
  churches?: { id?: string; name?: string } | { id?: string; name?: string }[] | null;
};

type IntegrationRow = {
  church_id: string;
  provider: string;
  access_token?: string | null;
  token_expires_at?: string | null;
  metadata?: Record<string, unknown> | null;
  updated_at?: string | null;
};

type SermonRow = {
  church_id: string;
  model_used: string | null;
  created_at: string;
};

type ActivityRow = {
  id: string;
  church_id: string;
  automation_type: string | null;
  category: string | null;
  task_name: string | null;
  time_saved_minutes: number | null;
  executed_at: string;
};

type TicketRow = {
  id: string;
  church_id: string | null;
  submitted_by: string | null;
  subject: string;
  body?: string | null;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  admin_notes?: string | null;
  created_at: string;
  updated_at?: string | null;
  churches?: { name?: string } | { name?: string }[] | null;
};

function getRelatedChurchName(
  churches: { name?: string } | { name?: string }[] | null | undefined,
): string | null {
  if (!churches) return null;
  if (Array.isArray(churches)) return churches[0]?.name ?? null;
  return churches.name ?? null;
}

function toRole(role: string): AdminRole {
  return role === "admin" ? "admin" : "viewer";
}

function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

function formatMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function getMonthStart(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getLastMonthBuckets(count: number): MonthPoint[] {
  const start = getMonthStart();
  start.setMonth(start.getMonth() - (count - 1));

  return Array.from({ length: count }, (_, index) => {
    const d = new Date(start);
    d.setMonth(start.getMonth() + index);
    return {
      key: formatMonthKey(d),
      label: formatMonthLabel(d),
      value: 0,
    };
  });
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function mapByCount(rows: { church_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    increment(counts, row.church_id);
  }
  return counts;
}

function inferProvider(model: string | null): string {
  const normalized = model?.toLowerCase().trim() ?? "";
  if (!normalized) return "Unknown";
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "Anthropic";
  }
  if (
    normalized.includes("openai") ||
    normalized.includes("gpt") ||
    normalized === "o1" ||
    normalized === "o3" ||
    normalized === "o4" ||
    normalized.startsWith("o1-") ||
    normalized.startsWith("o3-") ||
    normalized.startsWith("o4-")
  ) {
    return "OpenAI";
  }
  return "Unknown";
}

async function listAuthUsersMap(): Promise<Map<string, AuthUserSummary>> {
  const admin = createAdminClient();
  const users = new Map<string, AuthUserSummary>();
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("listAuthUsersMap:", error.message);
      return users;
    }

    for (const user of data.users ?? []) {
      users.set(user.id, {
        id: user.id,
        email: user.email ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
      });
    }

    if (!data.users || data.users.length < perPage) break;
    page += 1;
  }

  return users;
}

async function listAuthUsersFor(
  userIds: Iterable<string | null | undefined>,
): Promise<Map<string, AuthUserSummary>> {
  const wanted = new Set(
    Array.from(userIds).filter((id): id is string => Boolean(id)),
  );
  if (wanted.size === 0) return new Map();

  const allUsers = await listAuthUsersMap();
  const filtered = new Map<string, AuthUserSummary>();
  for (const id of Array.from(wanted)) {
    const user = allUsers.get(id);
    if (user) filtered.set(id, user);
  }
  return filtered;
}

function mapTicket(
  row: TicketRow,
  users: Map<string, AuthUserSummary>,
): AdminTicketListRow {
  return {
    id: row.id,
    subject: row.subject,
    churchId: row.church_id,
    churchName: getRelatedChurchName(row.churches),
    priority: row.priority,
    status: row.status,
    submittedBy: row.submitted_by,
    submittedByEmail: row.submitted_by
      ? (users.get(row.submitted_by)?.email ?? null)
      : null,
    createdAt: row.created_at,
  };
}

async function getSupportTickets(
  query: "all" | "recent-open" | { churchId: string },
): Promise<AdminTicketListRow[]> {
  const admin = createAdminClient();
  let builder = admin
    .from("support_tickets")
    .select("id, church_id, submitted_by, subject, status, priority, created_at, churches(name)")
    .order("created_at", { ascending: false });

  if (query === "recent-open") {
    builder = builder.neq("status", "resolved").limit(5);
  } else if (typeof query === "object") {
    builder = builder.eq("church_id", query.churchId);
  }

  const { data, error } = await builder;
  if (error) {
    console.error("getSupportTickets:", error.message);
    return [];
  }

  const rows = (data ?? []) as TicketRow[];
  const users = await listAuthUsersFor(rows.map((row) => row.submitted_by));
  return rows.map((row) => mapTicket(row, users));
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const admin = createAdminClient();
  const monthStart = getMonthStart().toISOString();

  const [
    churchesCount,
    usersCount,
    sermonsCount,
    activityRes,
    integrationsRes,
    newChurchesRes,
    recentTickets,
    dashboardUsage,
  ] = await Promise.all([
    admin.from("churches").select("id", { count: "exact", head: true }),
    admin.from("church_users").select("id", { count: "exact", head: true }),
    admin.from("sermons").select("id", { count: "exact", head: true }),
    admin.from("activity_log").select("time_saved_minutes"),
    admin.from("church_integrations").select("church_id, provider, access_token"),
    admin
      .from("churches")
      .select("id, name, created_at")
      .gte("created_at", monthStart)
      .order("created_at", { ascending: false }),
    getSupportTickets("recent-open"),
    getPlatformDashboardUsageTotals(),
  ]);

  const totalMinutes = ((activityRes.data ?? []) as { time_saved_minutes: number | null }[])
    .reduce((sum, row) => sum + (row.time_saved_minutes ?? 0), 0);

  const integrations = (integrationsRes.data ?? []) as IntegrationRow[];
  const googleChurches = new Set<string>();
  const facebookChurches = new Set<string>();
  for (const row of integrations) {
    if (!row.access_token) continue;
    if (row.provider === "google") googleChurches.add(row.church_id);
    if (row.provider === "facebook") facebookChurches.add(row.church_id);
  }

  return {
    stats: {
      totalChurches: churchesCount.count ?? 0,
      totalUsers: usersCount.count ?? 0,
      totalSermons: sermonsCount.count ?? 0,
      platformHoursSaved: toHours(totalMinutes),
      pastorMinutes30d: Math.round(dashboardUsage.pastorSeconds30d / 60),
      activeChurches30d: dashboardUsage.activeChurches30d,
    },
    integrationHealth: {
      totalChurches: churchesCount.count ?? 0,
      googleConnected: googleChurches.size,
      facebookConnected: facebookChurches.size,
    },
    recentTickets,
    newChurchesThisMonth: ((newChurchesRes.data ?? []) as ChurchRow[]).map(
      (row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
      }),
    ),
  };
}

export async function getAdminChurches(): Promise<AdminChurchListRow[]> {
  const admin = createAdminClient();
  const [churchesRes, usersRes, sermonsRes, integrationsRes, activityRes, invitesRes] =
    await Promise.all([
      admin
        .from("churches")
        .select(
          "id, name, created_at, stripe_onboarding_status, stripe_charges_enabled, onboarding_completed_at",
        )
        .order("name"),
      admin.from("church_users").select("church_id"),
      admin.from("sermons").select("church_id"),
      admin.from("church_integrations").select("church_id, provider, access_token"),
      admin.from("activity_log").select("church_id, executed_at"),
      admin
        .from("church_invites")
        .select("church_id, email, accepted_at, created_at")
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
    ]);

  const usersByChurch = mapByCount((usersRes.data ?? []) as { church_id: string }[]);
  const sermonsByChurch = mapByCount((sermonsRes.data ?? []) as { church_id: string }[]);
  const googleChurches = new Set<string>();
  const facebookChurches = new Set<string>();
  const lastActiveByChurch = new Map<string, string>();

  for (const row of (integrationsRes.data ?? []) as IntegrationRow[]) {
    if (!row.access_token) continue;
    if (row.provider === "google") googleChurches.add(row.church_id);
    if (row.provider === "facebook") facebookChurches.add(row.church_id);
  }

  for (const row of (activityRes.data ?? []) as Pick<ActivityRow, "church_id" | "executed_at">[]) {
    const current = lastActiveByChurch.get(row.church_id);
    if (!current || new Date(row.executed_at) > new Date(current)) {
      lastActiveByChurch.set(row.church_id, row.executed_at);
    }
  }

  type ChurchListRow = ChurchRow & {
    stripe_onboarding_status?: string;
    stripe_charges_enabled?: boolean;
    onboarding_completed_at?: string | null;
  };

  const pendingInviteByChurch = new Map<string, string>();
  for (const row of (invitesRes.data ?? []) as {
    church_id: string;
    email: string;
  }[]) {
    if (!pendingInviteByChurch.has(row.church_id)) {
      pendingInviteByChurch.set(row.church_id, row.email);
    }
  }

  return ((churchesRes.data ?? []) as ChurchListRow[]).map((church) => ({
    id: church.id,
    name: church.name,
    usersCount: usersByChurch.get(church.id) ?? 0,
    sermonsCount: sermonsByChurch.get(church.id) ?? 0,
    googleConnected: googleChurches.has(church.id),
    facebookConnected: facebookChurches.has(church.id),
    stripeOnboardingStatus: church.stripe_onboarding_status ?? "not_started",
    stripeChargesEnabled: Boolean(church.stripe_charges_enabled),
    onboardingCompletedAt: church.onboarding_completed_at ?? null,
    pendingInviteEmail: pendingInviteByChurch.get(church.id) ?? null,
    lastActiveAt: lastActiveByChurch.get(church.id) ?? null,
    createdAt: church.created_at,
  }));
}

function activityRangeStart(range: AdminActivityRange): string | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const start = new Date();
  start.setDate(start.getDate() - days);
  return start.toISOString();
}

export async function getAdminChurchActivity(
  churchId: string,
  filters: AdminActivityFilters = {},
): Promise<AdminActivityResult> {
  const admin = createAdminClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, filters.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = admin
    .from("activity_log")
    .select(
      "id, church_id, automation_type, category, task_name, time_saved_minutes, executed_at",
      { count: "exact" },
    )
    .eq("church_id", churchId)
    .order("executed_at", { ascending: false });

  if (filters.category) {
    query = query.eq("category", filters.category);
  }
  if (filters.type) {
    query = query.eq("automation_type", filters.type);
  }

  const rangeStart = activityRangeStart(filters.range ?? "all");
  if (rangeStart) {
    query = query.gte("executed_at", rangeStart);
  }

  const [activityRes, optionsRes] = await Promise.all([
    query.range(from, to),
    admin
      .from("activity_log")
      .select("automation_type, category")
      .eq("church_id", churchId),
  ]);

  if (activityRes.error) {
    console.error("getAdminChurchActivity:", activityRes.error.message);
  }

  const optionRows = (optionsRes.data ?? []) as {
    automation_type: string | null;
    category: string | null;
  }[];

  const types = Array.from(
    new Set(
      optionRows
        .map((row) => row.automation_type)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();

  const categories = Array.from(
    new Set(
      optionRows
        .map((row) => row.category)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();

  const total = activityRes.count ?? 0;

  return {
    rows: ((activityRes.data ?? []) as ActivityRow[]).map((row) => ({
      id: row.id,
      type: row.automation_type,
      category: row.category,
      task: row.task_name,
      timeSavedMinutes: row.time_saved_minutes ?? 0,
      createdAt: row.executed_at,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    filterOptions: { types, categories },
  };
}

export async function getAdminChurchDetail(
  churchId: string,
): Promise<AdminChurchDetail | null> {
  const admin = createAdminClient();
  const [
    churchRes,
    settingsRes,
    usersRes,
    integrationsRes,
    attendanceRes,
    supportTickets,
    usageSummary,
  ] = await Promise.all([
    admin
      .from("churches")
      .select(
        "id, name, timezone, created_at, slug, stripe_account_id, stripe_onboarding_status, stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements_due, giving_enabled_at",
      )
      .eq("id", churchId)
      .maybeSingle(),
    admin
      .from("church_settings")
      .select(
        "ai_provider, sermon_builder_mode, ai_model_override, denomination, preaching_style",
      )
      .eq("church_id", churchId)
      .maybeSingle(),
    admin
      .from("church_users")
      .select("id, user_id, role, created_at")
      .eq("church_id", churchId)
      .order("created_at", { ascending: false }),
    admin
      .from("church_integrations")
      .select("church_id, provider, token_expires_at, metadata, updated_at")
      .eq("church_id", churchId),
    admin
      .from("attendance_records")
      .select("service_date, total_present")
      .eq("church_id", churchId)
      .order("service_date", { ascending: false })
      .limit(8),
    getSupportTickets({ churchId }),
    getChurchDashboardUsageSummary(churchId),
  ]);

  if (churchRes.error || !churchRes.data) {
    return null;
  }

  const church = churchRes.data as ChurchRow & {
    slug?: string;
    stripe_account_id?: string | null;
    stripe_onboarding_status?: string;
    stripe_charges_enabled?: boolean;
    stripe_payouts_enabled?: boolean;
    stripe_requirements_due?: string[] | null;
    giving_enabled_at?: string | null;
  };
  const churchUsers = (usersRes.data ?? []) as ChurchUserRow[];
  const authUsers = await listAuthUsersFor(churchUsers.map((row) => row.user_id));
  const usageByUser = await getUserDashboardUsageByChurch(
    churchId,
    churchUsers.map((row) => row.user_id),
  );

  const integrations = (integrationsRes.data ?? []) as IntegrationRow[];
  const integrationDetails: AdminIntegrationDetail[] = (["google", "facebook"] as const).map(
    (provider) => {
      const row = integrations.find((item) => item.provider === provider);
      const metadata = row?.metadata ?? {};
      const accountLabel =
        provider === "google"
          ? ((metadata.email as string | undefined) ?? null)
          : ((metadata.page_name as string | undefined) ??
            (metadata.email as string | undefined) ??
            null);

      return {
        provider,
        connected: Boolean(row),
        accountLabel,
        tokenExpiresAt: row?.token_expires_at ?? null,
        updatedAt: row?.updated_at ?? null,
      };
    },
  );

  const attendance = ((attendanceRes.data ?? []) as {
    service_date: string;
    total_present: number | null;
  }[])
    .slice()
    .reverse()
    .map((row) => ({
      weekLabel: new Date(row.service_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      serviceDate: row.service_date,
      present: row.total_present ?? 0,
    }));

  const slug = church.slug ?? church.id;
  const requirementsDue = Array.isArray(church.stripe_requirements_due)
    ? church.stripe_requirements_due
    : [];

  return {
    church: {
      id: church.id,
      name: church.name,
      timezone: church.timezone ?? "America/New_York",
      slug,
      createdAt: church.created_at,
    },
    giving: {
      stripeOnboardingStatus: church.stripe_onboarding_status ?? "not_started",
      stripeChargesEnabled: Boolean(church.stripe_charges_enabled),
      stripePayoutsEnabled: Boolean(church.stripe_payouts_enabled),
      stripeAccountId: church.stripe_account_id ?? null,
      stripeRequirementsDue: requirementsDue,
      givingEnabledAt: church.giving_enabled_at ?? null,
      givePageUrl: getGivePageUrl(slug),
    },
    settings: settingsRes.data
      ? {
          aiProvider: String(settingsRes.data.ai_provider ?? ""),
          sermonBuilderMode: settingsRes.data.sermon_builder_mode ?? null,
          model: settingsRes.data.ai_model_override ?? null,
          denomination: settingsRes.data.denomination ?? null,
          preachingStyle: settingsRes.data.preaching_style ?? null,
        }
      : null,
    attendanceTrend: attendance,
    users: churchUsers.map((row) => {
      const usage = usageByUser.get(row.user_id);
      return {
        id: row.id,
        userId: row.user_id,
        email: authUsers.get(row.user_id)?.email ?? null,
        role: toRole(row.role),
        joinedAt: row.created_at,
        dashboardSeconds7d: usage?.seconds7d ?? 0,
        dashboardSeconds30d: usage?.seconds30d ?? 0,
        lastSeenAt: usage?.lastSeenAt ?? null,
      };
    }),
    integrations: integrationDetails,
    supportTickets,
    usageSummary,
  };
}

export async function getAdminUsers(): Promise<AdminPlatformUserRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("church_users")
    .select("id, church_id, user_id, role, created_at, churches(id, name)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getAdminUsers:", error.message);
    return [];
  }

  const rows = (data ?? []) as ChurchUserRow[];
  const authUsers = await listAuthUsersFor(rows.map((row) => row.user_id));

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    email: authUsers.get(row.user_id)?.email ?? null,
    churchId: row.church_id,
    churchName: getRelatedChurchName(row.churches) ?? "Unknown church",
    role: toRole(row.role),
    lastSignInAt: authUsers.get(row.user_id)?.lastSignInAt ?? null,
    joinedAt: row.created_at,
  }));
}

export async function getAdminSupportTickets(): Promise<AdminTicketListRow[]> {
  return getSupportTickets("all");
}

export async function getAdminSupportTicket(
  ticketId: string,
): Promise<AdminTicketDetail | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_tickets")
    .select(
      "id, church_id, submitted_by, subject, body, status, priority, admin_notes, created_at, updated_at, churches(name)",
    )
    .eq("id", ticketId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as TicketRow;
  const users = await listAuthUsersFor([row.submitted_by]);
  const mapped = mapTicket(row, users);

  return {
    ...mapped,
    body: row.body ?? null,
    adminNotes: row.admin_notes ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function getAdminChurchOptions(): Promise<AdminChurchSummary[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("churches")
    .select("id, name, created_at")
    .order("name");

  if (error) {
    console.error("getAdminChurchOptions:", error.message);
    return [];
  }

  return ((data ?? []) as ChurchRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  }));
}

export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const admin = createAdminClient();
  const monthBuckets = getLastMonthBuckets(12);
  const firstMonth = `${monthBuckets[0]?.key}-01T00:00:00.000Z`;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [churchesRes, activityRes, sermonsRes, recentActivityRes] =
    await Promise.all([
      admin
        .from("churches")
        .select("created_at")
        .gte("created_at", firstMonth),
      admin
        .from("activity_log")
        .select("executed_at, time_saved_minutes")
        .gte("executed_at", firstMonth),
      admin
        .from("sermons")
        .select("church_id, model_used, created_at")
        .gte("created_at", firstMonth),
      admin
        .from("activity_log")
        .select("automation_type, executed_at")
        .gte("executed_at", thirtyDaysAgo.toISOString()),
    ]);

  const churchesByMonth = new Map(monthBuckets.map((row) => [row.key, 0]));
  for (const row of (churchesRes.data ?? []) as { created_at: string }[]) {
    increment(churchesByMonth, formatMonthKey(new Date(row.created_at)));
  }

  const hoursByMonth = new Map(monthBuckets.map((row) => [row.key, 0]));
  for (const row of (activityRes.data ?? []) as {
    executed_at: string;
    time_saved_minutes: number | null;
  }[]) {
    increment(
      hoursByMonth,
      formatMonthKey(new Date(row.executed_at)),
      row.time_saved_minutes ?? 0,
    );
  }

  const models = new Map<string, number>();
  const providers = new Map<string, number>();
  for (const row of (sermonsRes.data ?? []) as SermonRow[]) {
    increment(models, row.model_used || "Unknown");
    increment(providers, inferProvider(row.model_used));
  }

  const activityTypes = new Map<string, number>();
  for (const row of (recentActivityRes.data ?? []) as {
    automation_type: string | null;
  }[]) {
    increment(activityTypes, row.automation_type || "Unknown");
  }

  return {
    churchesOverTime: monthBuckets.map((bucket) => ({
      ...bucket,
      value: churchesByMonth.get(bucket.key) ?? 0,
    })),
    hoursSavedPerMonth: monthBuckets.map((bucket) => ({
      ...bucket,
      value: toHours(hoursByMonth.get(bucket.key) ?? 0),
    })),
    aiModelUsage: Array.from(models, ([name, value]) => ({ name, value })).sort(
      (a, b) => b.value - a.value,
    ),
    sermonGenerationByProvider: Array.from(providers, ([name, value]) => ({
      name,
      value,
    })).sort((a, b) => b.value - a.value),
    automationActivityByType: Array.from(activityTypes, ([name, value]) => ({
      name,
      value,
    })).sort((a, b) => b.value - a.value),
  };
}
