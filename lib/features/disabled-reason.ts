/**
 * Why a feature is switched off, and what the church is told.
 *
 * Kept apart from the catalog because both the control center (choosing a
 * reason) and the dashboard (showing it) need this, and the catalog carries
 * icons that should not follow it everywhere.
 */

export const DISABLED_REASONS = [
  "coming_soon",
  "temporarily_unavailable",
  "not_in_plan",
  "custom",
] as const;

export type DisabledReason = (typeof DISABLED_REASONS)[number];

export function isDisabledReason(value: unknown): value is DisabledReason {
  return (
    typeof value === "string" &&
    (DISABLED_REASONS as readonly string[]).includes(value)
  );
}

export type DisabledReasonOption = {
  value: DisabledReason;
  /** What the operator picks in the control center. */
  label: string;
  /** One line telling the operator what the church will see. */
  hint: string;
};

export const DISABLED_REASON_OPTIONS: DisabledReasonOption[] = [
  {
    value: "temporarily_unavailable",
    label: "Temporarily unavailable",
    hint: "We're working on it and it will be back.",
  },
  {
    value: "coming_soon",
    label: "Coming soon",
    hint: "Not built for this church yet.",
  },
  {
    value: "not_in_plan",
    label: "Not in their plan",
    hint: "Available, but not part of what they pay for.",
  },
  {
    value: "custom",
    label: "Write my own",
    hint: "Say something specific to this church.",
  },
];

export type FeatureNotice = {
  reason: DisabledReason | null;
  note: string | null;
};

/**
 * The heading and body a member sees in place of the feature.
 *
 * `not_in_plan` stays the fallback for a switch thrown before this migration
 * existed — it is what those churches were already being told.
 */
export function describeDisabledFeature(
  featureLabel: string,
  notice: FeatureNotice | undefined,
): { title: string; message: string } {
  const note = notice?.note?.trim();

  switch (notice?.reason) {
    case "temporarily_unavailable":
      return {
        title: `${featureLabel} is off for now`,
        message:
          note ||
          `We've paused ${featureLabel} while we work on it. Nothing you've saved is affected, and it will be back shortly.`,
      };

    case "coming_soon":
      return {
        title: `${featureLabel} is coming soon`,
        message:
          note ||
          `${featureLabel} isn't ready for your church yet. We'll let you know the moment it is.`,
      };

    case "custom":
      return {
        title: `${featureLabel} isn't available`,
        message: note || `${featureLabel} is switched off for your church.`,
      };

    case "not_in_plan":
    default:
      return {
        title: `${featureLabel} isn't enabled`,
        message:
          note ||
          `${featureLabel} isn't part of your church's FaithForm plan yet. Reach out and we'll turn it on for you.`,
      };
  }
}

/** Where the "what do I do about it" button points for each reason. */
export function disabledFeatureAction(reason: DisabledReason | null | undefined): {
  href: string;
  label: string;
} {
  // Nothing for support to do about work already in hand, so send them back
  // rather than inviting a ticket we would only have to close.
  if (reason === "temporarily_unavailable" || reason === "coming_soon") {
    return { href: "/dashboard", label: "Back to dashboard" };
  }
  return { href: "/dashboard/support", label: "Contact support" };
}
