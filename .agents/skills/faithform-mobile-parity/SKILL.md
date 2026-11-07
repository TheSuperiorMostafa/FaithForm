---
name: faithform-mobile-parity
description: Use when changing FaithForm mobile API contracts, generated tokens/localization, native networking, push, or shared platform behaviour.
---

# FaithForm native and API parity

Shared specifications live in `contracts/faithform/v1/schema.json`, contract fixtures, and
`design/faithform/tokens.json`. API implementation is in `lib/mobile/v1/` and `app/api/mobile/v1/`.
Native implementations are `apps/faithform-ios/` and `apps/faithform-android/`.
Read `docs/faithform/P4_MOBILE_CONTRACT.md` for contract work and
`docs/faithform/P4_NATIVE_ARCHITECTURE.md` for native architecture; consult publication/push docs
only when those surfaces change.

Both apps consume one backend authority. Local caches are replaceable, scoped by account/church,
and cleared/partitioned through existing session logic. Do not create mobile-only authoritative
People, giving, attendance, or publication stores. Shared specs/tokens/fixtures do not imply shared UI.
Update the source spec and use established generators; do not hand-edit generated output.
Relevant commands: `pnpm contract:generate`, `pnpm design:generate`, `pnpm verify:generated`.
Check the actual generator and current target before changing generated surface assumptions.

Preserve secure credential storage, auth redirect allowlists, error vocabulary, deep-link scope,
and denied/offline/retry states. Push is a hint to fetch authorized state, not a new authority.
Select `pnpm ios:test`, `pnpm android:test`, or `pnpm test:contract` for the affected behaviour.
Use SwiftUI or Android references for the precise native issue; no implicit SDK/framework upgrade.
Follow project `AGENTS.md`. Read only the source and references relevant to this task; validation follows the changed behaviour and risk.
