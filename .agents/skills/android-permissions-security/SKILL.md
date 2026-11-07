---
name: android-permissions-security
description: Use for FaithForm Android runtime permission flows, exported components, IPC caller checks, or manifest security changes.
---

# Android permissions and IPC

Scope work to `apps/faithform-android/` and the requested permission/component path.
Read the corresponding runtime-permission, exported-component, Binder/caller, or URI-grant
section of `UPSTREAM.md`; do not apply its entire audit to an ordinary Android UI edit.
Preserve least privilege, caller identity, denied/revoked handling, and no secret/location logging.
For background attendance, apply the FaithForm attendance/privacy requirements as well.
Confirm API availability and installed AndroidX/SDK versions. An optional upstream example does
not authorize raising targetSdk, adding libraries, or changing every manifest component.
Validate the changed lifecycle/permission behaviour using existing platform tests or devices
when needed. No blanket dependency install, agent delegation, or all-app security scan.
