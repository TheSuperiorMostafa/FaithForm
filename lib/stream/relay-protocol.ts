import { z } from "zod";

/**
 * The wire format between the relay's recorder and FaithForm.
 *
 * Every body is parsed with these schemas before anything reads it. Anything
 * unknown is stripped, every number is bounded, and a batch is capped — the
 * relay is authenticated, but it is still a client, and a compromised relay
 * box must not be able to make FaithForm do unbounded work.
 */

const iso = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid timestamp");

export const relayTakeId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const relayPath = z.string().min(1).max(200);

export const RECORDER_ITEM_KINDS = ["init", "segment", "frame"] as const;

export const prepareItemSchema = z.object({
  kind: z.enum(RECORDER_ITEM_KINDS),
  seq: z.number().int().min(0).max(10_000_000),
  startedAt: iso.optional(),
  durationSec: z.number().gt(0).max(60).optional(),
  bytes: z.number().int().positive().max(512 * 1024 * 1024).optional(),
});

export const prepareBodySchema = z.object({
  path: relayPath,
  takeId: relayTakeId,
  takeStartedAt: iso.optional(),
  items: z.array(prepareItemSchema).min(1).max(50),
});

export const commitBodySchema = z.object({
  path: relayPath,
  takeId: relayTakeId,
  items: z
    .array(
      z.object({
        kind: z.enum(RECORDER_ITEM_KINDS),
        seq: z.number().int().min(0).max(10_000_000),
        bytes: z.number().int().positive().max(512 * 1024 * 1024).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const takeEventBodySchema = z.object({
  path: relayPath,
  takeId: relayTakeId,
  event: z.enum(["started", "ended"]),
  at: iso,
  lastSeq: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

export const heartbeatBodySchema = z.object({
  path: relayPath,
  takeId: relayTakeId.nullable().optional(),
  takeStartedAt: iso.nullable().optional(),
  publishing: z.boolean(),
  recorder: z
    .object({
      running: z.boolean(),
      version: z.string().max(40).nullable().optional(),
      lastSegmentClosedAt: iso.nullable().optional(),
      pendingUploads: z.number().int().min(0).max(1_000_000).optional(),
      reconnects: z.number().int().min(0).max(100_000).optional(),
    })
    .optional(),
  ingest: z
    .object({
      bitrateKbps: z.number().int().min(0).max(1_000_000).nullable().optional(),
      width: z.number().int().min(0).max(16_384).nullable().optional(),
      height: z.number().int().min(0).max(16_384).nullable().optional(),
      fps: z.number().min(0).max(1000).nullable().optional(),
      videoCodec: z.string().max(40).nullable().optional(),
      audioCodec: z.string().max(40).nullable().optional(),
    })
    .optional(),
});

export type PrepareBody = z.infer<typeof prepareBodySchema>;
export type PrepareItem = z.infer<typeof prepareItemSchema>;
export type CommitBody = z.infer<typeof commitBodySchema>;
export type TakeEventBody = z.infer<typeof takeEventBodySchema>;
export type HeartbeatBody = z.infer<typeof heartbeatBodySchema>;

export type PrepareDecision =
  | { kind: PrepareItem["kind"]; seq: number; action: "upload"; uploadUrl: string }
  /** Already stored. Commit it (again) and move on. */
  | { kind: PrepareItem["kind"]; seq: number; action: "done" }
  /** Not part of any broadcast. Safe to delete from the relay. */
  | { kind: PrepareItem["kind"]; seq: number; action: "skip" }
  /** Ask again later (for example an init segment before any segment of its take is kept). */
  | { kind: PrepareItem["kind"]; seq: number; action: "later" };
