const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isValidHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function normalizeHexColor(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return isValidHexColor(withHash) ? withHash.toUpperCase() : null;
}

export type GivingBrandingStyle = {
  "--give-primary": string;
  "--give-accent": string;
};

export function givingBrandingStyle(
  primary: string | null | undefined,
  accent: string | null | undefined,
): GivingBrandingStyle {
  return {
    "--give-primary": primary && isValidHexColor(primary) ? primary : "hsl(var(--primary))",
    "--give-accent": accent && isValidHexColor(accent) ? accent : "hsl(var(--accent))",
  };
}

export function hasChurchBranding(
  logoUrl: string | null | undefined,
  primary: string | null | undefined,
  accent: string | null | undefined,
): boolean {
  return Boolean(logoUrl || isValidHexColor(primary ?? "") || isValidHexColor(accent ?? ""));
}

/** Next occurrence of weekday (0=Sun … 6=Sat) at noon UTC for Stripe billing_cycle_anchor. */
export function nextWeekdayAnchorUnix(dayOfWeek: number): number {
  const now = new Date();
  const current = now.getUTCDay();
  let daysAhead = dayOfWeek - current;
  if (daysAhead <= 0) daysAhead += 7;
  const anchor = new Date(now);
  anchor.setUTCDate(anchor.getUTCDate() + daysAhead);
  anchor.setUTCHours(12, 0, 0, 0);
  return Math.floor(anchor.getTime() / 1000);
}

export function formatBillingDayLabel(
  interval: "week" | "month",
  billingDayOfMonth?: number,
  billingDayOfWeek?: number,
): string {
  if (interval === "month" && billingDayOfMonth) {
    const suffix =
      billingDayOfMonth === 1
        ? "st"
        : billingDayOfMonth === 2
          ? "nd"
          : billingDayOfMonth === 3
            ? "rd"
            : "th";
    return `${billingDayOfMonth}${suffix} of each month`;
  }
  if (interval === "week" && billingDayOfWeek !== undefined) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return `Every ${days[billingDayOfWeek]}`;
  }
  return "";
}
