#!/usr/bin/env bash
#
# Compiles FaithfulKit **for iOS**, which `swift build` does not.
#
# `swift build` and `swift test` run for the host — macOS. Every `#if os(iOS)`
# block in this package is therefore invisible to them: the camera scanner, the
# AVFoundation player adapter, the resource loader. That is most of the code
# that touches a platform framework, and none of it was ever compiled by a gate.
#
# It cost a real break. `AVFoundationScanner` held an `AVCaptureSession` — not
# `Sendable`, never will be — as actor state, and used `nonisolated(unsafe)` on
# a method, where it means nothing. Three errors and two warnings, all invisible
# to sixteen green gates, because none of them ever built for the platform the
# app ships on.
#
# This is slower than `swift build` and is worth it: it is the only thing here
# that compiles what a phone runs.

set -euo pipefail

cd "$(dirname "$0")/../apps/faithful-ios"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is not on PATH — install Xcode to run the iOS build gate." >&2
  exit 1
fi

DERIVED="${IOS_DERIVED_DATA:-${TMPDIR:-/tmp}/faithful-ios-device-build}"

# `generic/platform=iOS` compiles for the device without needing one attached,
# and without a simulator runtime — so this works on a machine that has Xcode
# and nothing else.
xcodebuild \
  -scheme Faithful \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  -quiet \
  build 2>&1 | tee "${DERIVED}.log" || {
    grep -E "error:" "${DERIVED}.log" | sort -u | head -40 >&2
    echo "iOS build failed." >&2
    exit 1
  }

# **Warnings are failures here.** A warning in code no other gate compiles is a
# warning nobody will ever see again.
if grep -E "warning:" "${DERIVED}.log" | grep -v "note:" | sort -u | grep . >&2; then
  echo "iOS build produced warnings, which this gate treats as failures." >&2
  exit 1
fi

echo "iOS device build clean: no errors, no warnings."
