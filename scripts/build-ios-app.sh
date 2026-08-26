#!/usr/bin/env bash
#
# Builds the Faithful iOS **app** — unsigned, for a device target.
#
# Deterministic on purpose:
#   * the project is generated from `project.yml`, so there is no committed
#     `.pbxproj` to drift;
#   * signing is switched off, so it needs no Apple account, no Team ID and no
#     provisioning profile — and cannot accidentally use somebody's;
#   * warnings are failures, because a warning in code no other gate compiles
#     is a warning nobody will ever see again.
#
# `--test` additionally runs the app-target tests on a simulator.

set -euo pipefail

cd "$(dirname "$0")/../apps/faithful-ios"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is not installed. Run: brew install xcodegen" >&2
  exit 1
fi
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is not on PATH — install Xcode." >&2
  exit 1
fi

xcodegen generate --spec project.yml --quiet

DERIVED="${IOS_APP_DERIVED_DATA:-${TMPDIR:-/tmp}/faithful-ios-app}"
LOG="${DERIVED}.log"

COMMON=(
  -project Faithful.xcodeproj
  -scheme Faithful
  -derivedDataPath "$DERIVED"
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  CODE_SIGN_IDENTITY=
)

if [ "${1:-}" = "--test" ]; then
  # A simulator is required to *run* tests. Building for one is not the same as
  # building for a device, so this is in addition to the device build below.
  #
  # The destination is resolved from what is actually installed rather than
  # hardcoded: a pinned device name and OS breaks on every Xcode update, and a
  # gate that breaks for that reason is a gate people start skipping.
  if [ -n "${IOS_TEST_DESTINATION:-}" ]; then
    DEST="$IOS_TEST_DESTINATION"
  else
    UDID=$(xcrun simctl list devices available --json \
      | python3 -c 'import json,sys
runtimes = json.load(sys.stdin)["devices"]
best = None
for runtime, devices in runtimes.items():
    if "iOS" not in runtime:
        continue
    for device in devices:
        if device.get("isAvailable") and "iPhone" in device["name"]:
            best = device["udid"]
            break
    if best:
        break
print(best or "")')
    if [ -z "$UDID" ]; then
      echo "No available iPhone simulator. Install one in Xcode, or set" >&2
      echo "IOS_TEST_DESTINATION to a destination xcodebuild accepts." >&2
      exit 1
    fi
    DEST="platform=iOS Simulator,id=$UDID"
  fi
  echo "Testing on $DEST"
  xcodebuild "${COMMON[@]}" -destination "$DEST" test 2>&1 | tee "$LOG" >/dev/null
else
  xcodebuild "${COMMON[@]}" -destination 'generic/platform=iOS' -quiet build 2>&1 | tee "$LOG"
fi

# Warnings are failures — but only *compiler* warnings about *this repository's*
# sources.
#
# A compiler diagnostic starts `path:line:col: warning:`. Xcode's toolchain also
# prints `timestamp tool[pid:tid] warning: …` for things like the app-intents
# metadata processor noting there is no AppIntents framework, which is true and
# is not a defect. Failing on those makes the gate fail for reasons nobody can
# fix, and a gate like that is one people start skipping.
#
# A warning inside a package dependency is excluded for the same reason: this
# build cannot fix Stripe's SDK.
if grep -E "^/.*:[0-9]+:[0-9]+: warning:" "$LOG" 2>/dev/null \
  | grep -vE "(DerivedData|SourcePackages|\.build|Faithful\.xcodeproj)/" \
  | sort -u | grep . >&2; then
  echo "iOS app build produced warnings in this repository's sources." >&2
  exit 1
fi

if [ "${1:-}" = "--test" ]; then
  # Reported rather than assumed: a test run that executed nothing exits 0 too,
  # and "the gate passed" would be a lie about zero tests.
  SUMMARY=$(grep -oE "Test run with [0-9]+ tests? in [0-9]+ suites? (passed|failed)" "$LOG" | tail -1)
  if [ -z "$SUMMARY" ]; then
    echo "The app test run reported no summary — it may have executed nothing." >&2
    exit 1
  fi
  echo "iOS app tests: $SUMMARY"
fi

echo "iOS app build clean: no errors, no warnings."
