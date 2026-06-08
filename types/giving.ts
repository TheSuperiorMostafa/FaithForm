export type StripeOnboardingStatus =
  | "not_started"
  | "pending"
  | "restricted"
  | "active"
  | "deauthorized";

export type DonationStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "refunded"
  | "disputed";

export type GiftType = "one_time" | "recurring";

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused"
  | "trialing"
  | "unpaid";

export type ChurchGivingProfile = {
  churchId: string;
  churchName: string;
  slug: string;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeOnboardingStatus: StripeOnboardingStatus;
  stripeRequirementsDue: string[];
  givingEnabledAt: string | null;
  givePageUrl: string;
  logoUrl: string | null;
  givingPrimaryColor: string | null;
  givingAccentColor: string | null;
  ein?: string | null;
  statementAddress?: string | null;
};

export type GivingFundRow = {
  id: string;
  churchId: string;
  name: string;
  slug: string;
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
};

export type GivingDonorRow = {
  id: string;
  name: string | null;
  email: string;
  ytdCents: number;
  giftCount: number;
  lastGiftAt: string | null;
};

export type GivingDonationRow = {
  id: string;
  amountCents: number;
  intendedAmountCents: number | null;
  currency: string;
  status: DonationStatus;
  giftType: GiftType;
  donorName: string | null;
  donorEmail: string | null;
  donorId: string | null;
  fundId: string | null;
  fundName: string | null;
  fundDesignation: string | null;
  feeCovered: boolean;
  stripeFeeCents: number | null;
  netAmountCents: number | null;
  refundReason: string | null;
  stripePaymentIntentId: string | null;
  createdAt: string;
};

export type GivingSubscriptionRow = {
  id: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  amountCents: number;
  currency: string;
  interval: string;
  status: SubscriptionStatus;
  donorName: string | null;
  donorEmail: string | null;
  donorId: string | null;
  fundId: string | null;
  fundName: string | null;
  fundDesignation: string | null;
  pausedAt: string | null;
  createdAt: string;
};

export type GivingKpis = {
  todayCents: number;
  monthCents: number;
  yearCents: number;
  todayGivers: number;
  monthGivers: number;
  yearGivers: number;
};

export type GivingSummary = GivingKpis & {
  recentDonations: GivingDonationRow[];
  failedSubscriptionCount: number;
};

export type FundGivingBreakdown = {
  fundId: string;
  fundName: string;
  totalCents: number;
  giftCount: number;
};

export type GiftsSearchFilters = {
  search?: string;
  fundId?: string;
  giftType?: GiftType;
  status?: DonationStatus;
  dateFrom?: string;
  dateTo?: string;
};

export type GiftsSearchResult = {
  donations: GivingDonationRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type StatementPeriod = {
  label: string;
  year: number;
  month: number | null;
  totalCents: number;
  count: number;
};
