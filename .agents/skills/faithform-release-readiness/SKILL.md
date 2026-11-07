---
name: faithform-release-readiness
description: Use for requested FaithForm release readiness, deployment/rollback preparation, provider wiring, or native store submission checks.
---

# FaithForm release readiness

Identify which surfaces are shipping: web/backend, database, iOS, Android, or specific providers.
Use the current `.github/workflows/ci.yml` and root `package.json` for actual gates.
Web's comprehensive gate is `pnpm ci:verify`; it is for release/CI scope, not every task.
Read `docs/faithform/P12_STORE_AND_PROVIDER_SETUP.md` for provider work,
`P12_STAGING_MIGRATION_AND_ROLLBACK.md` for rollout, and
`P12_ANDROID_PILOT_AND_RELEASE.md` for Android release work.

Check shared contract/token parity, compatible schema, provider signatures/retries, scheduled jobs,
push/publication authority, HTTPS/native configuration, privacy permissions, and rollback only
for affected surfaces. Preserve release gates and required source-generated assets. Available
signing keys or cloud credentials are not permission to submit, deploy, send, charge, or migrate.

Summarize observed readiness, blockers, and material unverified device/provider behaviour.
Do not repeat passed gates without new changes, and do not replace requested work with a universal
security audit or scorecard. A readiness report does not imply a live deployment.
Follow project `AGENTS.md`. Read only the source and references relevant to this task; validation follows the changed behaviour and risk.
