import { Film, History } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StreamSession } from "@/lib/stream/sessions";

/** A past broadcast plus the signed URL that plays it, if the file is ready. */
export type RecordingListItem = {
  id: string;
  title: string | null;
  createdAt: string;
  durationSec: number | null;
  playbackUrl: string | null;
};

type MediaManagerProps = {
  recordings: RecordingListItem[];
  sessions: StreamSession[];
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

/** How long a broadcast actually ran, from the moment it went live. */
function sessionLength(session: StreamSession): string | null {
  const start = session.liveStartedAt ?? session.ingestStartedAt;
  if (!start || !session.endedAt) return null;
  const seconds =
    (new Date(session.endedAt).getTime() - new Date(start).getTime()) / 1000;
  return formatDuration(seconds);
}

const SESSION_LABELS: Record<StreamSession["status"], string> = {
  preparing: "Did not start",
  waiting_for_encoder: "Did not start",
  live: "Live now",
  ended: "Streamed",
  error: "Ended with an error",
};

export function MediaManager({ recordings, sessions }: MediaManagerProps) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-bold">Library</h2>
          <p className="text-sm text-muted-foreground">
            Every service you&apos;ve streamed, saved here automatically. Nothing
            to set up — press play to watch one back.
          </p>
        </div>

        {recordings.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No recordings yet. They appear here after a live broadcast ends.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {recordings.map((recording) => {
              const length = formatDuration(recording.durationSec);
              return (
                <Card key={recording.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Film className="size-4 shrink-0 text-accent" aria-hidden />
                      {recording.title ?? "Service recording"}
                    </CardTitle>
                    <CardDescription>
                      {formatDateTime(recording.createdAt)}
                      {length ? ` · ${length}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {recording.playbackUrl ? (
                      <video
                        className="aspect-video w-full rounded-xl bg-black"
                        src={recording.playbackUrl}
                        controls
                        preload="none"
                        playsInline
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Still processing — check back shortly.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-bold">Stream history</h2>
          <p className="text-sm text-muted-foreground">
            When you went live and how long each broadcast ran.
          </p>
        </div>

        {sessions.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No broadcasts yet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {sessions.map((session) => {
                const start = session.liveStartedAt ?? session.createdAt;
                const length = sessionLength(session);
                return (
                  <li
                    key={session.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <History
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {session.title ?? "Live service"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(start)}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {SESSION_LABELS[session.status]}
                      {length ? ` · ${length}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
