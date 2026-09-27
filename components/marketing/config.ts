/** Destinations and media for the public FaithForm site. */
export const marketingConfig = {
  signIn: "/login",
  contactEmail: "support@faithform.io",
  contactPhone: "+12709709414",
  appStore: "https://apps.apple.com/app/id6814346417",
  appStoreQr: "/marketing/app-store-qr.svg",
  androidStore: null as string | null,
  walkthrough: {
    enabled: false,
    src: null as string | null,
    poster: null as string | null,
    captions: null as string | null,
  },
} as const;

export const contactHref = "#contact";
export const contactEmailHref =
  `mailto:${marketingConfig.contactEmail}?subject=${encodeURIComponent("Let's talk about FaithForm")}`;
