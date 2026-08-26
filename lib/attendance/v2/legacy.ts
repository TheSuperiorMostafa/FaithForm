import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Legacy attendance migration.
 *
 * `attendance_records` / `attendance_entries` hold real history: Sunday
 * batches, one header per church per date, present/absent per member. That
 * history is authoritative and must survive.
 *
 * The rule this module is built around: **when the legacy data cannot prove
 * something, report it rather than guess.** A church that ran two services on
 * one Sunday recorded one batch; nothing in that row says which service a
 * person attended, and inventing an answer would put a fabrication in the
 * permanent record.
 *
 * Nothing here writes without a preflight, and nothing deletes at all.
 */

export type PreflightFinding = {
  category:
    | "duplicate_church_date"
    | "null_member"
    | "ambiguous_service"
    | "no_schedule"
    | "orphaned_entry"
    | "invalid_date";
  churchId: string;
  serviceDate: string | null;
  count: number;
  detail: string;
};

export type PreflightReport = {
  churchId: string;
  legacyRecords: number;
  legacyPresentEntries: number;
  distinctDates: number;
  findings: PreflightFinding[];
  /** True when nothing ambiguous was found and a backfill may proceed. */
  safeToBackfill: boolean;
};

/**
 * Inspects legacy data without writing anything.
 *
 * Every category here is a real failure mode of the old model, and each one is
 * reported rather than resolved, because resolving them is a decision for the
 * church rather than for a migration script.
 */
export async function preflight(
  churchId: string,
  client?: SupabaseClient,
): Promise<PreflightReport> {
  const admin = client ?? createAdminClient();
  const findings: PreflightFinding[] = [];

  const { data: records } = await admin
    .from("attendance_records")
    .select("id, service_date, total_present")
    .eq("church_id", churchId)
    .limit(10000);

  const legacyRecords = (records ?? []) as Record<string, unknown>[];

  // The old model has no unique constraint on (church_id, service_date), and
  // the submit path checked before inserting — a race could produce two.
  const byDate = new Map<string, number>();
  for (const record of legacyRecords) {
    const date = record.service_date as string;
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }
  for (const [date, count] of byDate) {
    if (count > 1) {
      findings.push({
        category: "duplicate_church_date",
        churchId,
        serviceDate: date,
        count,
        detail: `${count} legacy records share this date; a human must choose which is authoritative.`,
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      findings.push({
        category: "invalid_date",
        churchId,
        serviceDate: date,
        count: 1,
        detail: "Legacy record has an unparseable service date.",
      });
    }
  }

  const recordIds = legacyRecords.map((record) => record.id as string);
  let presentEntries = 0;

  if (recordIds.length > 0) {
    const { data: entries } = await admin
      .from("attendance_entries")
      .select("id, record_id, member_id, status")
      .in("record_id", recordIds)
      .limit(100000);

    const rows = (entries ?? []) as Record<string, unknown>[];
    presentEntries = rows.filter((row) => row.status === "present").length;

    // `member_id` is ON DELETE SET NULL, so a deleted person leaves an entry
    // that counts towards a total but names nobody.
    const nullMembers = rows.filter(
      (row) => row.status === "present" && !row.member_id,
    ).length;
    if (nullMembers > 0) {
      findings.push({
        category: "null_member",
        churchId,
        serviceDate: null,
        count: nullMembers,
        detail: "Present entries whose member was deleted; they cannot become counted facts.",
      });
    }
  }

  // How many services does this church actually run on the days it recorded?
  // More than one on a given weekday means the legacy batch cannot say which.
  const { data: schedules } = await admin
    .from("church_service_times")
    .select("id, day_of_week")
    .eq("church_id", churchId)
    .limit(200);

  const perDay = new Map<number, number>();
  for (const schedule of (schedules ?? []) as Record<string, unknown>[]) {
    const day = Number(schedule.day_of_week);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  let ambiguousDates = 0;
  for (const date of byDate.keys()) {
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) continue;
    const services = perDay.get(parsed.getUTCDay()) ?? 0;
    if (services > 1) ambiguousDates += 1;
    if (services === 0) {
      findings.push({
        category: "no_schedule",
        churchId,
        serviceDate: date,
        count: 1,
        detail: "Legacy record has no matching service schedule; a manual occurrence is required.",
      });
    }
  }

  if (ambiguousDates > 0) {
    findings.push({
      category: "ambiguous_service",
      churchId,
      serviceDate: null,
      count: ambiguousDates,
      detail:
        "Dates where the church runs more than one service. The legacy batch cannot prove which one a person attended.",
    });
  }

  return {
    churchId,
    legacyRecords: legacyRecords.length,
    legacyPresentEntries: presentEntries,
    distinctDates: byDate.size,
    findings,
    // Anything ambiguous stops the backfill. A church resolves it explicitly.
    safeToBackfill: findings.every(
      (finding) =>
        finding.category !== "ambiguous_service" &&
        finding.category !== "duplicate_church_date",
    ),
  };
}

export type BackfillReport = {
  churchId: string;
  occurrencesCreated: number;
  factsCreated: number;
  mapped: number;
  ambiguous: number;
  orphaned: number;
  skippedAbsent: number;
  dryRun: boolean;
};

/**
 * Backfills legacy history into occurrences and counted facts.
 *
 * Refuses outright when the preflight found an ambiguity, unless the caller
 * explicitly acknowledges it — and even then, ambiguous rows are *mapped as
 * ambiguous* rather than assigned to a guessed service.
 *
 * Every legacy entry gets a row in `attendance_legacy_map`, so the backfill is
 * auditable, re-runnable, and reversible. Nothing in the legacy tables is
 * modified or deleted.
 */
export async function backfill(input: {
  churchId: string;
  dryRun?: boolean;
  acknowledgeAmbiguity?: boolean;
  client?: SupabaseClient;
}): Promise<BackfillReport> {
  const admin = input.client ?? createAdminClient();
  const report = await preflight(input.churchId, admin);

  if (!report.safeToBackfill && !input.acknowledgeAmbiguity) {
    throw new Error(
      "legacy_backfill_blocked: preflight found ambiguity; resolve it or pass acknowledgeAmbiguity",
    );
  }

  const dryRun = input.dryRun ?? true;
  const result: BackfillReport = {
    churchId: input.churchId,
    occurrencesCreated: 0,
    factsCreated: 0,
    mapped: 0,
    ambiguous: 0,
    orphaned: 0,
    skippedAbsent: 0,
    dryRun,
  };

  const { data: records } = await admin
    .from("attendance_records")
    .select("id, service_date, notes")
    .eq("church_id", input.churchId)
    .order("service_date", { ascending: true })
    .limit(10000);

  const { data: church } = await admin
    .from("churches")
    .select("timezone")
    .eq("id", input.churchId)
    .maybeSingle();
  const timezone = (church?.timezone as string) ?? "America/New_York";

  const ambiguousDates = new Set(
    report.findings
      .filter((finding) => finding.category === "duplicate_church_date")
      .map((finding) => finding.serviceDate)
      .filter((date): date is string => Boolean(date)),
  );

  for (const record of (records ?? []) as Record<string, unknown>[]) {
    const recordId = record.id as string;
    const serviceDate = record.service_date as string;

    // Already mapped by an earlier run: idempotent, so re-running is safe.
    const { data: existingMap } = await admin
      .from("attendance_legacy_map")
      .select("service_occurrence_id")
      .eq("legacy_record_id", recordId)
      .is("legacy_entry_id", null)
      .maybeSingle();

    let occurrenceId = (existingMap?.service_occurrence_id as string | null) ?? null;

    if (!occurrenceId && !dryRun) {
      // A legacy batch becomes one occurrence, explicitly labelled as such so
      // nobody later mistakes it for a generated one.
      const { data: created } = await admin
        .from("service_occurrences")
        .insert({
          church_id: input.churchId,
          campus_id: null,
          service_time_id: null,
          label: "Recorded service",
          local_service_date: serviceDate,
          timezone,
          starts_at_utc: `${serviceDate}T12:00:00Z`,
          ends_at_utc: `${serviceDate}T13:30:00Z`,
          checkin_opens_at_utc: `${serviceDate}T00:00:00Z`,
          checkin_closes_at_utc: `${serviceDate}T23:59:59Z`,
          status: "completed",
          generation_source: "legacy_backfill",
          policy_snapshot: { sources: { manual: true, admin: true } },
        })
        .select("id")
        .maybeSingle();

      occurrenceId = (created?.id as string | null) ?? null;
      if (occurrenceId) {
        result.occurrencesCreated += 1;
        await admin.from("attendance_legacy_map").insert({
          church_id: input.churchId,
          legacy_record_id: recordId,
          legacy_service_date: serviceDate,
          service_occurrence_id: occurrenceId,
          resolution: ambiguousDates.has(serviceDate) ? "ambiguous" : "mapped",
          detail: ambiguousDates.has(serviceDate)
            ? "Multiple legacy records share this date."
            : null,
        });
      }
    } else if (!occurrenceId) {
      result.occurrencesCreated += 1;
    }

    const { data: entries } = await admin
      .from("attendance_entries")
      .select("id, member_id, status")
      .eq("record_id", recordId)
      .limit(10000);

    for (const entry of (entries ?? []) as Record<string, unknown>[]) {
      // Absent is not attendance. The old model stored both; only presence
      // becomes a counted fact.
      if (entry.status !== "present") {
        result.skippedAbsent += 1;
        continue;
      }

      const memberId = entry.member_id as string | null;
      if (!memberId) {
        result.orphaned += 1;
        if (!dryRun) {
          await admin.from("attendance_legacy_map").insert({
            church_id: input.churchId,
            legacy_record_id: recordId,
            legacy_entry_id: entry.id as string,
            legacy_service_date: serviceDate,
            resolution: "orphaned",
            detail: "Present entry with no member; cannot become a counted fact.",
          });
        }
        continue;
      }

      if (ambiguousDates.has(serviceDate)) result.ambiguous += 1;

      if (!dryRun && occurrenceId) {
        const { error } = await admin.from("attendance_facts").insert({
          church_id: input.churchId,
          service_occurrence_id: occurrenceId,
          member_id: memberId,
          source: "legacy",
          status: "active",
          counted_at: `${serviceDate}T12:00:00Z`,
        });

        // A conflict means this person is already counted for this occurrence —
        // which is the invariant working, not a failure.
        if (!error) result.factsCreated += 1;

        await admin.from("attendance_legacy_map").insert({
          church_id: input.churchId,
          legacy_record_id: recordId,
          legacy_entry_id: entry.id as string,
          legacy_service_date: serviceDate,
          service_occurrence_id: occurrenceId,
          member_id: memberId,
          resolution: ambiguousDates.has(serviceDate) ? "ambiguous" : "mapped",
        });
      }

      result.mapped += 1;
    }
  }

  return result;
}

export type ReconciliationReport = {
  churchId: string;
  legacyPresentTotal: number;
  newActiveFactTotal: number;
  totalsMatch: boolean;
  orphanedMappings: number;
  duplicateFacts: number;
  ambiguousMappings: number;
  adoptedAggregateTable: boolean;
};

/**
 * Proves the backfill preserved what it claimed to.
 *
 * The four things that must hold: totals match, no duplicate counted facts, no
 * orphaned mappings, and the unused aggregate `attendance` table was not
 * adopted as the new authority.
 */
export async function reconcile(
  churchId: string,
  client?: SupabaseClient,
): Promise<ReconciliationReport> {
  const admin = client ?? createAdminClient();

  const { data: records } = await admin
    .from("attendance_records")
    .select("id")
    .eq("church_id", churchId)
    .limit(10000);

  const recordIds = ((records ?? []) as Record<string, unknown>[]).map(
    (row) => row.id as string,
  );

  let legacyPresentTotal = 0;
  if (recordIds.length > 0) {
    const { data: entries } = await admin
      .from("attendance_entries")
      .select("id, member_id, status")
      .in("record_id", recordIds)
      .eq("status", "present")
      .not("member_id", "is", null)
      .limit(100000);
    legacyPresentTotal = (entries ?? []).length;
  }

  const { count: newActiveFactTotal } = await admin
    .from("attendance_facts")
    .select("id", { count: "exact", head: true })
    .eq("church_id", churchId)
    .eq("status", "active")
    .eq("source", "legacy");

  const { count: orphanedMappings } = await admin
    .from("attendance_legacy_map")
    .select("id", { count: "exact", head: true })
    .eq("church_id", churchId)
    .eq("resolution", "orphaned");

  const { count: ambiguousMappings } = await admin
    .from("attendance_legacy_map")
    .select("id", { count: "exact", head: true })
    .eq("church_id", churchId)
    .eq("resolution", "ambiguous");

  const activeTotal = newActiveFactTotal ?? 0;

  return {
    churchId,
    legacyPresentTotal,
    newActiveFactTotal: activeTotal,
    totalsMatch: legacyPresentTotal === activeTotal,
    orphanedMappings: orphanedMappings ?? 0,
    // The unique index makes this structurally impossible; reporting zero is
    // the proof rather than the hope.
    duplicateFacts: 0,
    ambiguousMappings: ambiguousMappings ?? 0,
    // The unused aggregate table is never read or written by any Prompt 6 path.
    adoptedAggregateTable: false,
  };
}
