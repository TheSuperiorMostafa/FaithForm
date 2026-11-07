---
name: faithform-attendance
description: Use for FaithForm occurrence/check-in convergence, geofencing, QR/kiosk attendance, or automatic attendance privacy changes.
---

# FaithForm attendance convergence

Authoritative attendance lives in the shared backend, not a device's geofence state.
Read `docs/faithform/P6_ATTENDANCE_ARCHITECTURE.md` for counted facts and
`docs/faithform/P7_NATIVE_AUTOMATIC_ATTENDANCE_ARCHITECTURE.md` for native triggers.
Source paths: `lib/attendance/v2/occurrences.ts`, `check-in.ts`, `checkin-session.ts`, `kiosk.ts`,
`lib/mobile/v1/attendance-service.ts`, and the corresponding platform attendance implementation.

Manual, geofence, QR, kiosk, and admin inputs must converge through the existing server commands
and occurrence/person linkage. Preserve idempotency, ownership, service timezone/windows,
concurrent acceptance, corrections, and the difference between presence signals and counted facts.
A retry/offline replay must not add a second attendance fact or count for the wrong church/service.

Keep consent, denied/revoked permission handling, restricted background execution, account/church
switch teardown, and data minimization. Do not store or publish raw device location history merely
because it is available. Consult `docs/faithform/P7_PERMISSION_PRIVACY_AND_STORE_COMPLIANCE.md`
for permission-sensitive changes and the Android permission skill for actual platform controls.
Select affected convergence/privacy/native cases, rather than a mandatory full-platform rehearsal.
Follow project `AGENTS.md`. Read only the source and references relevant to this task; validation follows the changed behaviour and risk.
