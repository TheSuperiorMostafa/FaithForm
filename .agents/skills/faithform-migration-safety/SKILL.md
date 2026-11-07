---
name: faithform-migration-safety
description: Use when authoring or reviewing FaithForm Postgres migrations, RLS, backfills, or database rollout/restore changes.
---

# FaithForm migrations

Inspect the affected schema and callers, `supabase/migrations/`, and
`scripts/apply-versioned-migrations.mjs`. Files use the project's sequential four-digit naming
pattern, not Pivorta timestamp filenames. Preserve applied file hashes and migration ledgers;
new changes fix forward. Expand/backfill/contract while old application versions may still run.

Tenant scopes and staff/visitor permissions follow the church privacy skill. RLS and server-side
ownership both matter. Check constraints on existing rows, query-driven indexes, locks, batching,
and rollback/data retention for the changed tables.

The versioned runner requires `FAITHFORM_DB_TARGET=disposable` or `nonproduction`, DATABASE_URL,
and exactly one of `--all` or `--only <filename>`. These flags are safeguards, not proof the URL
is safe. Its per-migration transaction cannot contain CREATE INDEX CONCURRENTLY.
Inspect the chosen script before executing any package db command; some mutate configured targets.
Read `docs/faithform/P12_STAGING_MIGRATION_AND_ROLLBACK.md` for rollout and staging rehearsal.
Use `pnpm test:migrations` and relevant database/security checks when the changed SQL warrants
it; connection credentials alone do not authorize production mutation or a local reset.
Follow project `AGENTS.md`. Read only the source and references relevant to this task; validation follows the changed behaviour and risk.
