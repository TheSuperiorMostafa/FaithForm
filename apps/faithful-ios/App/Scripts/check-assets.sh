#!/usr/bin/env bash
#
# Fails a Release or Staging build when the app icon is still a placeholder.
#
# A missing app icon is a *warning* in Xcode, which means it survives all the
# way to an archive and is discovered by App Store Connect rejecting the upload.
# This turns it into a build failure, in the two configurations where it
# matters, so it is found on the machine that can fix it.
#
# Debug builds are allowed to run without one: a developer checking a layout
# should not have to draw an icon first.

set -euo pipefail

if [ "${CONFIGURATION:-Debug}" = "Debug" ]; then
  exit 0
fi

ICONSET="${SRCROOT}/App/Resources/Assets.xcassets/AppIcon.appiconset"
COUNT=$(find "$ICONSET" -name '*.png' 2>/dev/null | wc -l | tr -d ' ')

if [ "$COUNT" -eq 0 ]; then
  echo "error: the app icon is still a placeholder." >&2
  echo "error: add a 1024x1024 PNG to App/Resources/Assets.xcassets/AppIcon.appiconset" >&2
  echo "error: and reference it from that folder's Contents.json." >&2
  echo "error: See docs/faithful/P12_IOS_APP_TARGET_AND_SIGNING.md." >&2
  exit 1
fi

touch "${DERIVED_FILE_DIR}/asset-check.stamp"
