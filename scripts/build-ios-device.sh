#!/usr/bin/env bash
#
# Compiles FaithfulKit **for iOS**, which `swift build` does not.
#
# `swift build` and `swift test` run for the host — macOS. Every `#if os(iOS)`
# block in this package is therefore invisible to them: the camera scanner, the
# AVFoundation player adapter, the Stripe payment sheet. That is most of the code
# that touches a platform framework.
#
# It cost a real break. `AVFoundationScanner` held an `AVCaptureSession` — not
# `Sendable`, never will be — as actor state, and used `nonisolated(unsafe)` on
# a method, where it means nothing. Three errors and two warnings, all invisible
# to sixteen green gates, because none of them ever built for the platform the
# app ships on.
#
# ## Why this is now a thin wrapper
#
# When it was written there was no iOS application, so it built the package
# directly with `xcodebuild -scheme Faithful`. Prompt 12 added an app target, and
# `Faithful.xcodeproj` now sits in the same directory — so that same command
# resolves to the *project*, not the package, and fails asking for a development
# team.
#
# Rather than fight the ambiguity, this delegates. `build-ios-app.sh` compiles
# the app for a device, and the app depends on FaithfulKit, so FaithfulKit is
# compiled for iOS as part of it — with the same warnings-as-errors rule. The
# check this script exists for is performed; it is simply performed by the build
# that now subsumes it.
#
# Kept as a separate command because CI and the documents refer to it by name,
# and because what it *means* — "the iOS-only code compiles for iOS" — is worth
# stating separately from "the app builds".

set -euo pipefail

exec "$(dirname "$0")/build-ios-app.sh" "$@"
