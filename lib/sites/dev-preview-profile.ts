import type { SiteProfile } from "@/types/site";

/**
 * A made-up church for the dev-only format preview (`/dev-site-preview/<key>`).
 * Every field a section can show is filled in, so a format is judged with its
 * busiest page rather than an empty one.
 */
export const DEV_PREVIEW_PROFILE: SiteProfile = {
  slug: "dev-preview",
  name: "Riverside Community Church",
  tagline: "Led by faith, rooted in love, committed in Christ.",
  description:
    "A come-as-you-are family worshiping, growing and serving together on Main Street since 1952.",
  missionStatement: "To love God, love people, and make disciples who make a difference.",
  visionStatement: "A church where every generation finds a seat at the table.",
  denomination: "Church of the Nazarene",
  logoUrl: null,
  coverImageUrl: null,
  address: "120 Main Street",
  city: "Springfield",
  state: "KY",
  zip: "40069",
  phone: "+15025550134",
  email: "office@riversidechurch.org",
  googleMapsUrl: null,
  facebookUrl: "https://facebook.com/riversidechurch",
  instagramUrl: "https://instagram.com/riversidechurch",
  youtubeUrl: "https://youtube.com/@riversidechurch",
  tiktokUrl: "https://tiktok.com/@riversidechurch",
  xUrl: "https://x.com/riversidechurch",
  livestreamUrl: "https://youtube.com/@riversidechurch/live",
  serviceTimes: [
    { label: "Sunday School", dayOfWeek: 0, startTime: "09:15", endTime: "10:15", kind: "regular", notes: null },
    { label: "Sunday Worship", dayOfWeek: 0, startTime: "10:30", endTime: "11:45", kind: "regular", notes: null },
    { label: "Wednesday Prayer", dayOfWeek: 3, startTime: "18:30", endTime: "19:30", kind: "midweek", notes: null },
  ],
  staff: [
    { name: "Ben Johnson", title: "Senior Pastor", bio: "Ben has served Riverside since 2011.", photoUrl: null },
    { name: "Maria Lopez", title: "Children's Director", bio: null, photoUrl: null },
    { name: "Sam Carter", title: "Worship Leader", bio: null, photoUrl: null },
  ],
  events: [
    { title: "Fall Festival", date: "2026-10-24", location: "Church lawn", note: "Food, games and hayrides." },
    { title: "Thanksgiving Service", date: "2026-11-25", location: "Sanctuary", note: null },
  ],
  media: [
    { id: "s1", title: "A Seat for Everyone", series: "The Table of Grace", speaker: "Ben Johnson", date: "2026-09-13", videoUrl: null, thumbnail: null },
    { id: "s2", title: "Bread for the Journey", series: "The Table of Grace", speaker: "Ben Johnson", date: "2026-09-06", videoUrl: null, thumbnail: null },
    { id: "s3", title: "Come as You Are", series: "Welcome Home", speaker: "Sam Carter", date: "2026-08-30", videoUrl: null, thumbnail: null },
  ],
  givingEnabled: true,
};
