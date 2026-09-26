import { ShieldCheck } from "lucide-react";

import { NO_CODE_LOG_DESCRIPTION, NO_CODE_LOG_TITLE } from "@/components/checkin/copy";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { InitialsAvatar, List, ListRow } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import {
  formatReleaseTime,
  noCodeReleaseSummary,
  type NoCodeRelease,
} from "@/lib/checkin/release-log";

/**
 * Beneath the weekly numbers: every child handed over without the family's
 * pickup code, newest first, with who released them, when, and why.
 */
export function NoCodeReleaseLog({
  releases,
  total,
  failed = false,
  weekCount,
  timeZone,
}: {
  releases: NoCodeRelease[];
  total: number;
  failed?: boolean;
  weekCount: number;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="no-code-releases" className="flex w-full flex-col gap-4">
      <SectionHeader
        id="no-code-releases"
        title={NO_CODE_LOG_TITLE}
        description={
          <>
            <p>{NO_CODE_LOG_DESCRIPTION}</p>
            {!failed && (
              <p className="mt-1 font-semibold text-foreground">
                {noCodeReleaseSummary(total, weekCount)}
                {total > releases.length && ` Showing the newest ${releases.length}.`}
              </p>
            )}
          </>
        }
      />

      {failed ? (
        <ErrorState
          compact
          refreshOnRetry
          title="The list of releases without a code didn't load"
          description="The numbers above are fine. Try again, and if it keeps happening, contact FaithForm support."
        />
      ) : releases.length === 0 ? (
        <EmptyState
          compact
          icon={ShieldCheck}
          title="Every child went home with a pickup code"
          description="If a child is ever released without the family's code, it's listed here with who released them and why."
        />
      ) : (
        <List label={NO_CODE_LOG_TITLE}>
          {releases.map((release) => (
            <ListRow
              key={release.sessionId}
              leading={<InitialsAvatar name={release.childName} />}
              title={release.childName}
              subtitle={
                <>
                  <span className="block whitespace-normal text-foreground/80">
                    Released by{" "}
                    <span className="font-semibold text-foreground">{release.releasedByLabel}</span>
                    {" · "}
                    <time dateTime={release.releasedAt}>
                      {formatReleaseTime(release.releasedAt, timeZone)}
                    </time>
                  </span>
                  {(release.roomName || release.releasedToName) && (
                    <span className="block whitespace-normal">
                      {[
                        release.roomName && `From ${release.roomName}`,
                        release.releasedToName && `Went home with ${release.releasedToName}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {release.reason && (
                    <span className="block whitespace-normal">Reason: “{release.reason}”</span>
                  )}
                </>
              }
            />
          ))}
        </List>
      )}
    </section>
  );
}
