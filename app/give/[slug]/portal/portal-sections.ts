export const PORTAL_SECTIONS = [
  { id: "give-now", label: "Give now" },
  { id: "statements", label: "Statements" },
  { id: "payment-methods", label: "Payment methods" },
  { id: "payment-history", label: "Payment history" },
] as const;

export type PortalSection = (typeof PORTAL_SECTIONS)[number]["id"];
