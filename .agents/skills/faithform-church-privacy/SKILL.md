---
name: faithform-church-privacy
description: Use when changing FaithForm staff/visitor authorization, People linkage, church-scoped data, or privacy-sensitive access.
---

# FaithForm identity and privacy

Use `lib/auth/church.ts` and relevant guards for staff context. Visitor relationships and verified
People claims use `lib/faithform/relationships.ts`, `relationship-state.ts`, and `people-claims.ts`.
Read `docs/faithform/P3_IDENTITY_AND_TENANCY_REPORT.md` for identity changes, or
`docs/faithform/P8_SECURITY_AND_PRIVACY_MODEL.md` for the relevant privacy surface.

Keep Supabase account, church staff membership, visitor profile/relationship, operational People,
and donor identities distinct. Following/joining a church or selecting it in the UI does not
grant dashboard access. A People link requires the established verified claim flow; email match
alone is insufficient. Preserve blocked/left states and tenant-safe concurrent transitions.

Server-side church authorization and ownership checks remain necessary, particularly for admin
clients that bypass RLS. Public discovery returns only public fields. Member/child/location data,
private messages, and staff-only details must not leak through API, logs, notifications, or caches.
Use cross-church/role/blocked examples for changed access controls. No whole-app audit for a
copy change and no live customer-data pull as a verification shortcut.
Follow project `AGENTS.md`. Read only the source and references relevant to this task; validation follows the changed behaviour and risk.
