import { notFound } from "next/navigation";

import { ChurchInfoEditor } from "@/components/member-app/church-info-editor";
import type { ChurchAppInfo, ChurchAppInfoContext } from "@/lib/queries/church-app-info";

export const dynamic = "force-dynamic";

const SAMPLE: ChurchAppInfo = {
  name: "Grace Community Church",
  tagline: "A church for the whole city",
  about:
    "We're a family of believers in the heart of Lexington. Sundays are relaxed — come as you are, the coffee's on, and there's a great program for kids from nursery through fifth grade.\n\nMidweek, small groups meet in homes across the city, and on Wednesday nights we gather for prayer and worship.",
  logoUrl: "",
  coverImageUrl:
    "https://images.unsplash.com/photo-1438232992991-995b7058bbb3?auto=format&fit=crop&w=1200&q=70",
  address: "123 Main Street",
  city: "Lexington",
  state: "KY",
  zip: "40507",
  phone: "(859) 555-0142",
  email: "hello@gracecommunity.org",
  website: "gracecommunity.org",
  mapsUrl: "",
  social: {
    instagram: "@gracelex",
    facebook: "facebook.com/gracelex",
    youtube: "@gracelex",
    tiktok: "",
    x: "",
    podcast: "https://podcasts.apple.com/us/podcast/grace-community/id1",
  },
  quickLinks: [
    { clientId: "l1", label: "Plan a visit", url: "gracecommunity.org/visit" },
    { clientId: "l2", label: "Prayer request", url: "gracecommunity.org/prayer" },
  ],
  serviceTimes: [
    { clientId: "s1", id: "s1", label: "Sunday Worship", dayOfWeek: 0, startTime: "09:00" },
    { clientId: "s2", id: "s2", label: "Sunday Worship", dayOfWeek: 0, startTime: "11:00" },
    { clientId: "s3", id: "s3", label: "Wednesday Night Prayer", dayOfWeek: 3, startTime: "19:00" },
  ],
};

const CONTEXT: ChurchAppInfoContext = {
  denomination: "Non-denominational",
  timezone: "America/New_York",
  accentColor: "#2F5D8A",
  primaryColor: null,
  quickLinksAvailable: true,
};

/**
 * Development only: the Member App's church page editor with a sample church
 * and no database or sign-in, so the editor and its phone preview can be
 * designed and checked in a browser. Saving fails here by design. Production
 * returns 404.
 */
export default function DevChurchPagePreview() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-7xl">
        <ChurchInfoEditor initial={SAMPLE} context={CONTEXT} canEdit />
      </div>
    </main>
  );
}
