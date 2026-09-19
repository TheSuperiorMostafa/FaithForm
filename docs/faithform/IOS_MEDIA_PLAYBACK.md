# iPhone media startup and rotation

## Changes

The recording screen owns playback cleanup. Its metadata view no longer stops
the player when hidden in landscape. Live and recording layouts retain one
video surface in the same SwiftUI position while resizing it, preserving the
player item, buffered bytes, playback position, and play/pause state.

The progressive recording resource loader delivers each arriving data chunk
to AVFoundation instead of accumulating an entire HTTP range. It supplies
content information as soon as headers arrive, handles open-ended ranges,
checks range offsets, and cancels obsolete requests on seek or dismissal.
Capability headers and memory-only media loading are preserved. A fresh
playback request replaces the previous capability; retries retain renewals.

Player items do not preload optional asset keys before playback. Automatic
stall avoidance remains enabled: disabling it can turn an empty buffer into a
pause that requires manual recovery. No fixed bitrate or buffer-size guess is
used; available bandwidth and the stream itself still affect startup time.

`StreamThumbnail` renders a clear loading view above its branded placeholder.
An empty success-only view could leave the poster's loading task unmounted,
so a card would never start fetching its image.

## Regression proof

Run `scripts/verify-ios-live-playback.sh`, supplying an available simulator ID
with `IOS_TEST_DESTINATION` and an optional `IOS_APP_DERIVED_DATA` cache path.

The suite exercises real HLS and progressive MP4 playback. The MP4 fixture
delays a large response's tail by 12 seconds; startup must occur within eight
seconds, before that tail arrives. Both layouts are resized between portrait
and landscape and must retain the same video surface and player item. The
recording must use only one playback grant and stop on dismissal. A separate
rendered-image assertion checks that the thumbnail appears before playback.

`swift test --filter 'Media|LivePlayback'` checks the platform-independent
playback state, capability renewal, error handling, and live recovery behavior.

On September 19, 2026, all five simulator checks and 48 media unit tests passed.
The progressive fixture started in 0.69 seconds while the response tail was
still delayed. This is a local simulator measurement, not a guarantee for a
church's network or encoding settings.

## Apple references

- [Incremental resource-loading responses](https://developer.apple.com/documentation/avfoundation/avassetresourceloadingdatarequest/respond(with:))
- [Automatic stall avoidance](https://developer.apple.com/documentation/avfoundation/avplayer/automaticallywaitstominimizestalling)
- [Measuring and optimizing HLS performance](https://devstreaming-cdn.apple.com/videos/wwdc/2018/502plwzfxg5p7w4na/502/502_measuring_and_optimizing_hls_performance.pdf)
- [Create a more responsive media app](https://developer.apple.com/videos/play/wwdc2022/110379/)
