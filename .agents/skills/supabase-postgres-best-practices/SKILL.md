---
name: supabase-postgres-best-practices
description: Use for Postgres schema, RLS, index, locking, connection, or query-performance work in these Supabase projects.
---

# Supabase Postgres reference

Use the project migration/authorization skill for local tenant rules and rollout. This vendor
reference complements it; it does not establish a database target or authorize applying SQL.

Read only the relevant `references/` files:
- Query/index work: `query-*`, `schema-*`.
- RLS and exposed rows: `security-*`.
- Blocking/backfills: `lock-*`.
- Connection exhaustion: `conn-*`.
- Access patterns/diagnostics: `data-*`, `monitor-*`.

Inspect the actual query and schema. Use available EXPLAIN evidence for optimization; a
recommended index must serve a real filter/join/order pattern. Do not apply blanket indexing.
Service-role access bypasses RLS: preserve server authorization and tenant filters as well.
Applied migrations stay immutable. Use an explicitly selected disposable environment for
rehearsals. Credentials and MCP availability alone do not authorize production queries/writes.
The longer upstream entry is retained in `UPSTREAM.md`, not loaded by default.
