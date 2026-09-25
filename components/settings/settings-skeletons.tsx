import { Apple, Calendar, Clock, MapPin, Monitor, Moon, Play, Plus, Share2, Sun } from "lucide-react";

import {
  SETTINGS_PAGE_DESCRIPTION,
  SETTINGS_PAGE_TITLE,
  type ResolvedSettingsTab,
} from "@/components/settings/settings-tabs-config";
import { MAX_ATTACHMENTS_PER_CHURCH, MAX_ATTACHMENT_BYTES } from "@/lib/announcements/attachments";
import { FOLLOW_UP_TEMPLATE_LABELS } from "@/lib/sms/follow-up-messages";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/*
 * Settings loading states. Each one mirrors its section card for card: the
 * same titles and descriptions as real text (they never change), and a
 * shimmer only where the church's own data goes.
 */

function InputSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div className={className ?? "flex flex-col gap-2"}>
      <p className="text-[15px] font-medium leading-none">{label}</p>
      <Skeleton className="h-11 w-full rounded-[10px]" />
    </div>
  );
}

function ChurchInfoSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Logo and cover photo</CardTitle>
          <CardDescription className="text-[15px]">
            How your church looks in the app and on your website.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-8 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              <p className="text-[15px] font-semibold">Logo</p>
              <Skeleton className="size-32 rounded-2xl" />
              <p className="text-sm text-muted-foreground">
                A square image. It shows on your app page and website.
              </p>
              <Skeleton className="h-11 w-40 rounded-[10px]" />
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-[15px] font-semibold">Cover photo</p>
              <Skeleton className="aspect-video w-full max-w-md rounded-2xl" />
              <p className="text-sm text-muted-foreground">
                A wide photo of your building or people. It fills the top of your app page.
              </p>
              <Skeleton className="h-11 w-48 rounded-[10px]" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Church details</CardTitle>
          <CardDescription className="text-[15px]">
            Entered once and used everywhere: your app page, your website and the phone assistant.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <InputSkeleton label="Church name" />
          <div className="grid gap-5 sm:grid-cols-2">
            <InputSkeleton label="Phone" />
            <InputSkeleton label="Email" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="size-5 text-accent" strokeWidth={1.75} aria-hidden />
            Address
          </CardTitle>
          <CardDescription className="text-[15px]">
            Where people come on Sunday. It&apos;s shown with a map link in the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <InputSkeleton label="Street address" />
          <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <InputSkeleton label="City" />
            <InputSkeleton label="State" />
            <InputSkeleton label="ZIP code" />
          </div>
          <div className="rounded-2xl bg-muted/50 px-5 py-4">
            <p className="text-[15px] font-semibold">Time zone</p>
            <Skeleton className="my-1 h-5 w-64 max-w-full" />
            <p className="mt-1 text-sm text-muted-foreground">
              Service times and reminders use this. If it&apos;s wrong, send us a message and
              we&apos;ll change it for you.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-5 text-accent" strokeWidth={1.75} aria-hidden />
            Service times
          </CardTitle>
          <CardDescription className="text-[15px]">
            Shown in the app as &ldquo;Next service&rdquo;. Attendance uses them to set up each
            Sunday.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-[minmax(0,1fr)_170px_140px_auto] sm:items-end"
            >
              <InputSkeleton label="Name" />
              <InputSkeleton label="Day" />
              <InputSkeleton label="Starts at" />
              <Skeleton className="h-11 w-28 rounded-[10px]" />
            </div>
          ))}
          <span className="inline-flex min-h-11 items-center gap-2 self-start rounded-[10px] border border-primary/45 px-6 text-[15px] font-semibold text-primary dark:border-accent/60 dark:text-accent">
            <Plus className="size-5" aria-hidden />
            Add a service time
          </span>
          <p className="text-sm text-muted-foreground">A service with no name isn&apos;t saved.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>App colours</CardTitle>
          <CardDescription className="text-[15px]">
            Used across your church&apos;s app and giving page. Tap a pair to use it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-2xl" />
            ))}
          </div>
          <div className="flex min-h-12 items-center rounded-2xl border border-border bg-card/50 px-5 py-3">
            <span className="space-y-0.5">
              <span className="block text-[15px] font-semibold">Custom colour</span>
              <span className="block text-sm text-muted-foreground">
                Match your church&apos;s own colours exactly.
              </span>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TeamSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Your team"
        description="Everyone who can sign in to FaithForm for your church, and what each person can open."
        action={
          <span className="inline-flex min-h-12 items-center gap-2 rounded-[10px] bg-accent px-7 text-base font-semibold text-accent-foreground">
            <Plus className="size-5" aria-hidden />
            Invite someone
          </span>
        }
      />
      <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
        {Array.from({ length: 3 }).map((_, index) => (
          <li key={index} className="flex flex-col gap-3 rounded-2xl px-4 py-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="h-4 w-44 max-w-full" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Skeleton className="h-11 w-44 rounded-[10px]" />
              <Skeleton className="h-11 w-28 rounded-[10px]" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ACCOUNT_ROWS = [
  {
    icon: Calendar,
    name: "Google: Calendar and Gmail",
    purpose:
      "Fills in your announcements from Google Calendar and drafts the weekly email in Gmail. One sign-in covers both.",
  },
  {
    icon: Apple,
    name: "iCloud Calendar",
    purpose: "Fills in your announcements from the calendar you keep on iPhone or Mac.",
  },
  { icon: Play, name: "YouTube", purpose: "Streams your services live to your YouTube channel." },
  {
    icon: Share2,
    name: "Facebook Page",
    purpose: "Posts your announcements and streams your services to your church's Facebook Page.",
  },
];

function AccountsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-0 shadow-sm">
        {ACCOUNT_ROWS.map(({ icon: Icon, name, purpose }) => (
          <li key={name} className="flex flex-col gap-4 px-4 py-5 sm:px-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <span
                  aria-hidden
                  className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
                >
                  <Icon className="size-6" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold">{name}</p>
                    <Skeleton className="h-7 w-28 rounded-full" />
                  </div>
                  <p className="text-[15px] leading-snug text-muted-foreground">{purpose}</p>
                </div>
              </div>
              <Skeleton className="h-11 w-40 shrink-0 rounded-[10px]" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Weekly announcement email</CardTitle>
          <CardDescription className="text-[15px]">
            Every Monday, FaithForm writes a draft email listing this week&apos;s events. It waits
            in your email&apos;s Drafts folder, so nothing is sent until you send it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-border p-5">
            <div className="space-y-1">
              <p className="text-base font-semibold">Write a draft every Monday</p>
              <Skeleton className="h-5 w-56" />
            </div>
            <Skeleton className="h-8 w-14 rounded-full" />
          </div>
          <InputSkeleton label="Address the draft to (optional)" />
          <div className="flex min-h-12 items-center rounded-2xl border border-border bg-card/50 px-5 py-3">
            <span className="space-y-0.5">
              <span className="block text-[15px] font-semibold">Change the email&apos;s wording</span>
              <span className="block text-sm text-muted-foreground">
                The subject line and the message around your events.
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-11 w-44 rounded-[10px]" />
            <Skeleton className="h-11 w-52 rounded-[10px]" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files in the weekly email</CardTitle>
          <CardDescription className="text-[15px]">
            Anything here is attached to every Monday draft, like a bulletin, a sign-up sheet or a
            flyer. Up to {MAX_ATTACHMENTS_PER_CHURCH} files,{" "}
            {Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB each. Big photos are shrunk to fit.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-11 w-36 rounded-[10px]" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Follow-up text messages</CardTitle>
          <CardDescription className="text-[15px]">
            When you follow up with someone who missed church, FaithForm texts them one of these.
            The message changes the more Sundays in a row they have missed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {FOLLOW_UP_TEMPLATE_LABELS.map((label) => (
            <div key={label} className="flex flex-col gap-3 rounded-2xl border border-border p-5">
              <p className="text-base font-semibold leading-none">{label}</p>
              <Skeleton className="h-[96px] w-full rounded-[10px]" />
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">Must include their name. Tap to add it:</p>
                <span className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-border px-4 text-sm">
                  <Plus className="size-4 text-accent" aria-hidden />
                  <span className="font-semibold">Their first name</span>
                  <span className="font-mono text-muted-foreground">[Name]</span>
                </span>
              </div>
              <div className="rounded-xl bg-muted/50 px-4 py-3">
                <p className="text-sm font-semibold text-muted-foreground">How it reads</p>
                <Skeleton className="mt-2 h-5 w-full" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AdvancedSkeleton() {
  const themes = [
    { icon: Sun, label: "Light", hint: "Dark text on a light page." },
    { icon: Moon, label: "Dark", hint: "Light text on a dark page." },
    { icon: Monitor, label: "Match my computer", hint: "Follows your computer or phone's own setting." },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Light or dark</CardTitle>
          <CardDescription className="text-[15px]">
            How FaithForm looks on this computer. Only you see this.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {themes.map(({ icon: Icon, label, hint }) => (
              <div
                key={label}
                className="flex min-h-[104px] flex-col items-start gap-2 rounded-2xl border-2 border-border bg-background p-4"
              >
                <Icon className="size-6 text-primary dark:text-accent" strokeWidth={1.75} aria-hidden />
                <span className="text-base font-semibold">{label}</span>
                <span className="text-sm text-muted-foreground">{hint}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GivingSkeleton() {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-4">
        <Skeleton className="size-12 shrink-0 rounded-2xl" />
        <div className="space-y-1.5">
          <CardTitle>Giving is set up on the Giving page</CardTitle>
          <CardDescription className="text-[15px]">
            Online giving, funds, deposits to your bank and year-end statements are all in one
            place now.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-12 w-40 rounded-[10px]" />
      </CardContent>
    </Card>
  );
}

/** The body of one section while it loads. */
export function SettingsTabSkeleton({
  tab,
  bare = false,
}: {
  tab: ResolvedSettingsTab;
  /** Set when an outer SkeletonContainer already announces the loading state. */
  bare?: boolean;
}) {
  const body = (() => {
    switch (tab) {
      case "church":
        return <ChurchInfoSkeleton />;
      case "team":
        return <TeamSkeleton />;
      case "accounts":
        return <AccountsSkeleton />;
      case "messages":
        return <MessagesSkeleton />;
      case "advanced":
        return <AdvancedSkeleton />;
      case "giving":
        return <GivingSkeleton />;
    }
  })();

  if (bare) return body;
  return <SkeletonContainer label="settings section">{body}</SkeletonContainer>;
}

/** Title and description, identical to the loaded page. */
export function SettingsPageHeader() {
  return <PageHeader title={SETTINGS_PAGE_TITLE} description={SETTINGS_PAGE_DESCRIPTION} />;
}
