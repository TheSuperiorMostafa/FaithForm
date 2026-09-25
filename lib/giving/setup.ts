/**
 * The "Start accepting gifts" steps on the Giving page, and which one to show.
 *
 * 1. details  Church name and tax ID (EIN), for statements.
 * 2. connect  Connect your bank (the payment partner's onboarding).
 * 3. funds    Choose the funds people can give to, and show them in the app.
 * 4. ready    Share the giving link and QR code.
 *
 * Steps 1–2 are needed before a gift can be taken. Steps 3–4 only make sense
 * once the bank is connected, so they are never shown before that, whatever
 * the URL says.
 */
export const SETUP_STEPS = ["details", "connect", "funds", "ready"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  details: "Your church",
  connect: "Connect your bank",
  funds: "Choose funds",
  ready: "You're ready",
};

function isSetupStep(value: unknown): value is SetupStep {
  return typeof value === "string" && (SETUP_STEPS as readonly string[]).includes(value);
}

/**
 * Returns the step to show, or null when the church is set up and the page
 * should show the giving overview.
 */
export function resolveSetupStep(input: {
  requested: string | null | undefined;
  chargesEnabled: boolean;
  hasEin: boolean;
  hasAccount: boolean;
}): SetupStep | null {
  const requested = isSetupStep(input.requested) ? input.requested : null;
  if (input.chargesEnabled) {
    return requested === "funds" || requested === "ready" ? requested : null;
  }
  if (requested === "details" || requested === "connect") return requested;
  return input.hasEin || input.hasAccount ? "connect" : "details";
}

export function setupStepIndex(step: SetupStep): number {
  return SETUP_STEPS.indexOf(step);
}
