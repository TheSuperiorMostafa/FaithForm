/** Destinations and media for the public FaithForm site. */
export const marketingConfig = {
  signIn: "/login",
  contactEmail: "support@faithform.io",
  contactPhone: "+12709709414",
  appStore: "https://apps.apple.com/app/id6814346417",
  appStoreQr: "/marketing/app-store-qr.svg",
  androidStore: null as string | null,
  walkthrough: {
    src: "/marketing/faithform-film-v1-1080p.mp4",
    mobileSrc: "/marketing/faithform-film-v1-720p.mp4",
    poster: "/marketing/faithform-film-v1-poster.jpg",
    captions: "/marketing/faithform-film-v1.vtt",
  },
} as const;

export const contactHref = "#contact";
export const contactEmailHref =
  `mailto:${marketingConfig.contactEmail}?subject=${encodeURIComponent("Let's talk about FaithForm")}`;
