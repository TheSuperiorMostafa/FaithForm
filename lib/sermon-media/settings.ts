import { DEFAULT_POST_SCHEDULE, parseSchedule, type PostSchedule } from "@/lib/sermon-media/schedule";

export type StudioSettings = {
  autoTranscribe: boolean;
  language: string;
  maxConcurrentJobs: number;
  autoConfirmRange: boolean;
  autoClips: boolean;
  clipsPerService: number;
  postSchedule: PostSchedule;
};

/** Studio defaults for a church that has the feature but never changed a setting. */
export function settingsFromRow(row: Record<string, unknown> | null): StudioSettings {
  return {
    autoTranscribe: row?.auto_transcribe === undefined || row?.auto_transcribe === null ? true : Boolean(row.auto_transcribe),
    language: String(row?.language ?? "auto"),
    maxConcurrentJobs: Number(row?.max_concurrent_jobs ?? 2),
    autoConfirmRange: row?.auto_confirm_range === undefined || row?.auto_confirm_range === null ? true : Boolean(row.auto_confirm_range),
    autoClips: row?.auto_clips === undefined || row?.auto_clips === null ? true : Boolean(row.auto_clips),
    clipsPerService: Number(row?.clips_per_service ?? 3),
    postSchedule: parseSchedule(row?.post_schedule ?? DEFAULT_POST_SCHEDULE),
  };
}

