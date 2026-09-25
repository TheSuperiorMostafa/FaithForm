"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Play, Share2, Unplug } from "lucide-react";
import { toast } from "sonner";

import { disconnectIntegrationAction } from "@/app/dashboard/settings/integration-actions";
import { AccountNoticeMessage, AccountRow } from "@/components/settings/account-row";
import { AppleCalendarConnect } from "@/components/settings/apple-calendar-connect";
import {
  ACCOUNT_NAMES,
  DISCONNECT_CONSEQUENCES,
  accountReturnTo,
  readAccountNotice,
  type AccountId,
  type AccountNotice,
} from "@/components/settings/connected-accounts-messages";
import { buttonVariants, Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { List } from "@/components/ui/list-row";
import type { FeatureKey } from "@/lib/features/catalog";
import type { IntegrationStatus } from "@/lib/integrations/tokens";

export type ConnectedAccountsCardProps = {
  status: IntegrationStatus;
  /** Features this admin can use; decides which accounts are worth offering. */
  allowedFeatures: FeatureKey[];
};

/** A connect link that goes through the provider's sign-in and comes back here. */
function ConnectLink({ account, label }: { account: AccountId; label: string }) {
  const path =
    account === "google"
      ? "/api/integrations/google/connect"
      : account === "youtube"
        ? "/api/integrations/youtube/connect"
        : "/api/integrations/facebook/connect";
  const href = `${path}?return_to=${encodeURIComponent(accountReturnTo(account))}`;
  return (
    <a href={href} className={buttonVariants()}>
      {label}
    </a>
  );
}

/**
 * The accounts FaithForm signs in to for the church: Google (calendar and
 * Gmail together, since it is one sign-in), iCloud Calendar, YouTube and
 * Facebook. Each row says what the connection does, and any result lands
 * beside the row it is about.
 */
export function ConnectedAccountsCard({ status, allowedFeatures }: ConnectedAccountsCardProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<AccountNotice | null>(null);

  useEffect(() => {
    const fromUrl = readAccountNotice(searchParams);
    if (fromUrl) setNotice(fromUrl);
  }, [searchParams]);

  const allowed = new Set(allowedFeatures);
  const canUseAnnouncements = allowed.has("announcements");
  const canUseLive = allowed.has("live_stream");

  // A row is offered when it is useful to this church, and always kept while
  // it is connected so it can still be disconnected.
  const show = {
    google: canUseAnnouncements || status.google.connected || status.google.needsReconnect,
    apple: canUseAnnouncements || status.apple.connected || status.apple.needsReconnect,
    youtube: canUseLive || status.youtube.connected || status.youtube.needsReconnect,
    facebook:
      canUseAnnouncements || canUseLive || status.facebook.connected || status.facebook.needsReconnect,
  };

  const disconnect = async (account: AccountId) => {
    const name = ACCOUNT_NAMES[account];
    const ok = await confirmAction({
      title: `Disconnect ${name}?`,
      description: DISCONNECT_CONSEQUENCES[account],
      confirmLabel: `Disconnect ${name}`,
      destructive: true,
    });
    if (!ok) return;

    startTransition(async () => {
      try {
        const result = await disconnectIntegrationAction(account);
        if (result?.error) {
          setNotice({ kind: "error", message: result.error, account });
          return;
        }
        const message = `${name} is disconnected.`;
        setNotice({ kind: "success", message, account });
        toast.success(message);
        router.refresh();
      } catch {
        setNotice({
          kind: "error",
          message: `We couldn't disconnect ${name}. Please try again.`,
          account,
        });
      }
    });
  };

  const noticeFor = (account: AccountId) => (notice?.account === account ? notice : null);

  if (!show.google && !show.apple && !show.youtube && !show.facebook) {
    return (
      <EmptyState
        compact
        icon={Calendar}
        title="Nothing to connect yet"
        description="Calendars, YouTube and Facebook connect here once Announcements or Live is turned on for your church."
      />
    );
  }

  const googleDetail = status.google.connected
    ? [
        `Signed in as ${status.google.email ?? "your Google account"}`,
        status.google.calendarId && status.google.calendarId !== "primary"
          ? `Calendar: ${status.google.calendarId}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="flex flex-col gap-4">
      {notice && notice.account === null && <AccountNoticeMessage notice={notice} />}

      <List label="Connected accounts" className="p-0">
        {show.google && (
          <AccountRow
            icon={<Calendar className="size-6" strokeWidth={1.75} />}
            name="Google: Calendar and Gmail"
            purpose="Fills in your announcements from Google Calendar and drafts the weekly email in Gmail. One sign-in covers both."
            state={status.google}
            detail={googleDetail}
            notice={noticeFor("google")}
            actions={
              status.google.connected ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => disconnect("google")}
                  disabled={pending}
                >
                  <Unplug aria-hidden />
                  Disconnect
                </Button>
              ) : (
                <ConnectLink
                  account="google"
                  label={status.google.needsReconnect ? "Reconnect Google" : "Connect Google"}
                />
              )
            }
          />
        )}

        {show.apple && (
          <AppleCalendarConnect
            status={status.apple}
            onDisconnect={() => disconnect("apple")}
            disconnectDisabled={pending}
            notice={noticeFor("apple")}
          />
        )}

        {show.youtube && (
          <AccountRow
            icon={<Play className="size-6" strokeWidth={1.75} />}
            name="YouTube"
            purpose="Streams your services live to your YouTube channel."
            state={status.youtube}
            detail={
              status.youtube.connected
                ? `Channel: ${status.youtube.channelTitle ?? "your YouTube channel"}`
                : null
            }
            notice={noticeFor("youtube")}
            actions={
              status.youtube.connected ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => disconnect("youtube")}
                  disabled={pending}
                >
                  <Unplug aria-hidden />
                  Disconnect
                </Button>
              ) : (
                <ConnectLink
                  account="youtube"
                  label={status.youtube.needsReconnect ? "Reconnect YouTube" : "Connect YouTube"}
                />
              )
            }
          />
        )}

        {show.facebook && (
          <AccountRow
            icon={<Share2 className="size-6" strokeWidth={1.75} />}
            name="Facebook Page"
            purpose="Posts your announcements and streams your services to your church's Facebook Page."
            state={status.facebook}
            detail={
              status.facebook.connected
                ? `Page: ${status.facebook.pageName ?? "your Facebook Page"}`
                : null
            }
            notice={noticeFor("facebook")}
            actions={
              status.facebook.connected ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => disconnect("facebook")}
                  disabled={pending}
                >
                  <Unplug aria-hidden />
                  Disconnect
                </Button>
              ) : (
                <ConnectLink
                  account="facebook"
                  label={status.facebook.needsReconnect ? "Reconnect Facebook" : "Connect Facebook"}
                />
              )
            }
          />
        )}
      </List>
    </div>
  );
}
