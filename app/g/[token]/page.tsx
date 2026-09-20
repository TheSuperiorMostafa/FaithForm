import type { Metadata } from "next";

import { previewGroupInvitation } from "@/lib/groups/membership";
import { groupInitials } from "@/lib/groups/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Where a group's share link lands in a browser.
 *
 * It says which group and which church — nothing a stranger holding a
 * forwarded link could mine — and hands the link to the Faithful app, which
 * redeems it for the signed-in person. The token stays in the path: never in
 * a query string, never sent on as a Referer, never indexed or cached.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "You're invited | Faithful",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{16,512}$/;

export default async function GroupInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = TOKEN.test(token) ? await previewGroupInvitation(createAdminClient(), token) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {preview ? (
          <>
            {/*
              A group photo is square — the same 1:1 logo the iPhone and
              Android apps show. Filling a 16:9 banner with it sliced the top
              and bottom off the logo, so the photo keeps its shape and the
              band behind it is the same photo blurred past recognition,
              exactly as the invitation screen in the apps does it.
            */}
            <div className="relative flex h-48 items-center justify-center overflow-hidden bg-gradient-to-br from-accent/15 to-card">
              {preview.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a public bucket URL; no optimizer round trip for a one-off page
                <img src={preview.coverImageUrl} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl" />
              )}
              <span className="relative flex size-28 items-center justify-center overflow-hidden rounded-[34px] border border-border bg-gradient-to-br from-accent/30 to-primary/10 shadow-lg">
                {preview.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- same public bucket URL
                  <img src={preview.coverImageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span aria-hidden className="text-3xl font-semibold text-foreground/70">{groupInitials(preview.groupName)}</span>
                )}
              </span>
            </div>
            <div className="space-y-5 p-6">
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">{preview.churchName} invited you to join</p>
                <h1 className="font-heading text-2xl font-bold tracking-tight">{preview.groupName}</h1>
              </div>
              <a
                href={`faithform://group-invite/${encodeURIComponent(token)}`}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Open in the Faithful app
              </a>
              <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
                <p>
                  Don&apos;t have the app yet? Download <strong className="text-foreground">Faithful</strong> from the
                  App Store or Google Play, sign in, and choose {preview.churchName} as your church. Then open this
                  link again on your phone.
                </p>
                <p>This link is personal to your group. Please don&apos;t post it publicly.</p>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3 p-6 text-center">
            <h1 className="font-heading text-xl font-bold tracking-tight">This invitation isn&apos;t available</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              It may have expired, reached its limit, or been withdrawn. Ask the group&apos;s leader for a new link.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
