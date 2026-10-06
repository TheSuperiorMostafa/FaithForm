import type Stripe from "stripe";
import { toYMD, zonedDateTimeToUtcMs } from "@/lib/utils/dates";

export type GivingInterval = "week" | "biweekly" | "month" | "year";
export type RecurringScheduleInput = {
  interval: GivingInterval;
  timeZone?: string;
  startDate?: string;
  billingDayOfMonth?: number;
  billingDayOfWeek?: number;
};

export function stripeRecurringPrice(interval: GivingInterval) {
  return { interval: interval === "biweekly" ? "week" as const : interval, interval_count: interval === "biweekly" ? 2 : 1 };
}

/** Interpret date-only schedules in the church timezone, around local noon. */
export function recurringFirstChargeAt(input: RecurringScheduleInput, now = new Date(), allowPastForRetry = false): string | null {
  if (!input.startDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new Error("invalid_start_date");
  const date = new Date(`${input.startDate}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.startDate) throw new Error("invalid_start_date");
  const timeZone = input.timeZone ?? "UTC";
  const today = toYMD(now, timeZone);
  if ((!allowPastForRetry && input.startDate < today) || date.getTime() > now.getTime() + 366 * 86400000) throw new Error("invalid_start_date");
  // Today preserves the existing immediate first-gift flow.
  if (input.startDate === today) return null;
  if (input.interval === "month" && input.billingDayOfMonth != null) {
    const day = input.billingDayOfMonth;
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("invalid_billing_day");
    const setDay = () => date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
    const earliest = date.getTime();
    setDay();
    if (date.getTime() < earliest) { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1); setDay(); }
  } else if ((input.interval === "week" || input.interval === "biweekly") && input.billingDayOfWeek != null) {
    const day = input.billingDayOfWeek;
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error("invalid_billing_day");
    date.setUTCDate(date.getUTCDate() + (day - date.getUTCDay() + 7) % 7);
  }
  const ymd = date.toISOString().slice(0, 10);
  let timestamp = zonedDateTimeToUtcMs(ymd, "12:00", timeZone);
  // Stripe month anchors use UTC days. Keep both calendar dates aligned even
  // in UTC+14/-12, so a 31st never turns into the 1st at the church.
  const utcDate = new Date(timestamp).toISOString().slice(0, 10);
  if (utcDate < ymd) timestamp = zonedDateTimeToUtcMs(ymd, "14:00", timeZone);
  if (utcDate > ymd) timestamp = zonedDateTimeToUtcMs(ymd, "10:00", timeZone);
  return new Date(timestamp).toISOString();
}

/** A future first charge has no charge/proration today. Stripe collects a setup instead. */
export function recurringSubscriptionSchedule(input: {
  interval: GivingInterval;
  firstChargeAt?: string | null;
  billingDayOfMonth?: number | null;
  billingDayOfWeek?: number | null;
}, now = new Date()): Partial<Stripe.SubscriptionCreateParams> {
  if (input.firstChargeAt) {
    const timestamp = Math.floor(new Date(input.firstChargeAt).getTime() / 1000);
    if (timestamp <= Math.floor(now.getTime() / 1000)) throw new Error("scheduled_start_passed");
    return {
      trial_end: timestamp,
      proration_behavior: "none",
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      ...(input.interval === "month" && input.billingDayOfMonth ? {
        billing_cycle_anchor_config: { day_of_month: input.billingDayOfMonth, hour: new Date(input.firstChargeAt).getUTCHours(), minute: 0, second: 0 },
      } : {}),
    };
  }
  if (input.interval === "month" && input.billingDayOfMonth) {
    return { billing_cycle_anchor_config: { day_of_month: input.billingDayOfMonth } };
  }
  if ((input.interval === "week" || input.interval === "biweekly") && input.billingDayOfWeek != null) {
    const next = new Date(now);
    let days = (input.billingDayOfWeek - next.getUTCDay() + 7) % 7;
    if (days === 0) days = input.interval === "biweekly" ? 14 : 7;
    next.setUTCDate(next.getUTCDate() + days);
    return { billing_cycle_anchor: Math.floor(next.getTime() / 1000) };
  }
  return {};
}
