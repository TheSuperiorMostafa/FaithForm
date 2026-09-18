import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const IOS = "apps/faithform-ios";
const ANDROID = "apps/faithform-android/app/src/main/kotlin/io/faithform/app";

test("Go Live publishes the event to the FaithForm apps", () => {
  const source = read("lib/stream/go-live.ts");
  const start = source.slice(
    source.indexOf("export async function startLiveBroadcast("),
    source.indexOf("export async function endLiveBroadcast("),
  );

  assert.match(start, /publishToFaithForm\(/);
  assert.match(start, /kind:\s*"live"/);
  assert.match(start, /visibility:\s*"public"/);
  assert.match(start, /actorUserId:\s*userId/);
});

// ---------------------------------------------------------------------------
// A service that starts while the app is open appears without a relaunch
// ---------------------------------------------------------------------------

test("iPhone keeps the live state current while Home and Watch are showing", () => {
  const home = read(`${IOS}/App/HomeTab.swift`);
  const views = read(`${IOS}/Sources/FaithFormKit/Components/MediaViews.swift`);
  const model = read(`${IOS}/Sources/FaithFormKit/Features/MediaModel.swift`);

  assert.match(model, /public func refreshLive\(\) async/);
  // Polled on a timer while visible and in the foreground, and on return.
  assert.match(views, /func refreshesLiveStatus\(/);
  assert.match(views, /await model\.refreshLive\(\)/);
  assert.match(home, /\.refreshesLiveStatus\(features\.media\)/);
  // The archive list carries the same poll.
  assert.match(views, /\.refreshable \{ await model\.refresh\(\) \}\s*\n\s*\.refreshesLiveStatus\(model\)/);
  // And pulling Home down asks too, not only the feed.
  assert.match(home, /onRefresh: \{ await features\.media\.refreshLive\(\) \}/);
});

test("Android keeps the live state current while Home and Watch are showing", () => {
  const home = read(`${ANDROID}/ui/host/HomeAndChurchTabs.kt`);
  const watch = read(`${ANDROID}/ui/media/WatchHost.kt`);
  const polling = read(`${ANDROID}/ui/media/LiveStatusPolling.kt`);
  const models = read(
    "apps/faithform-android/core/media/src/main/kotlin/io/faithform/app/media/MediaModels.kt",
  );

  assert.match(models, /suspend fun refreshLive\(\)/);
  assert.match(polling, /repeatOnLifecycle\(Lifecycle\.State\.RESUMED\)/);
  assert.match(polling, /list\.value\.refreshLive\(\)/);
  assert.match(home, /PollLiveStatus\(media\)/);
  assert.match(watch, /PollLiveStatus\(list\)/);
  // Pull-to-refresh exists on both, and Home's refreshes the live state.
  assert.match(home, /media\.value\.refreshLive\(\)/);
  assert.match(read(`${ANDROID}/ui/schedule/ScheduleScreen.kt`), /PullToRefreshBox\(/);
  assert.match(read(`${ANDROID}/ui/media/MediaScreens.kt`), /PullToRefreshBox\(/);
});

// ---------------------------------------------------------------------------
// "Watch live" opens the service full screen, playing
// ---------------------------------------------------------------------------

test("iPhone Watch live opens the full-screen player from Home and Watch", () => {
  const home = read(`${IOS}/App/HomeTab.swift`);
  const watch = read(`${IOS}/App/WatchTab.swift`);
  const root = read(`${IOS}/App/RootView.swift`);
  const screen = read(`${IOS}/App/LivePlayerScreen.swift`);

  assert.match(home, /features\.media\.phase\.live/);
  assert.match(home, /LiveNowHero\(live:\s*live\)\s*\{\s*root\.watchLive\(live\)\s*\}/);
  assert.match(watch, /onWatchLive: \{ root\.watchLive\(\$0\) \}/);
  // Not a tab switch onto a screen with a second button to press.
  assert.doesNotMatch(home, /root\.selectedTab\s*=\s*\.watch/);
  assert.doesNotMatch(watch, /LiveServiceScreen/);

  assert.match(root, /\.fullScreenCover\(item: \$model\.livePresentation\)/);
  assert.match(root, /LivePlayerScreen\(/);
  // Playback starts as it opens.
  assert.match(screen, /await made\.start\(\)/);
});

test("Android Watch live opens the full-screen player from Home and Watch", () => {
  const home = read(`${ANDROID}/ui/host/HomeAndChurchTabs.kt`);
  const schedule = read(`${ANDROID}/ui/schedule/ScheduleScreen.kt`);
  const watch = read(`${ANDROID}/ui/media/WatchHost.kt`);
  const host = read(`${ANDROID}/ui/host/SignedInHost.kt`);
  const screen = read(`${ANDROID}/ui/media/LivePlayerScreen.kt`);

  assert.match(home, /MediaListModel\(/);
  assert.match(home, /mediaState\.liveCard/);
  assert.match(schedule, /LiveNowHero\(/);
  assert.match(schedule, /onWatch = \{ onWatchLive\(live\) \}/);
  assert.match(home, /onWatchLive = appViewModel::watchLive/);
  assert.match(watch, /onWatchLive = appViewModel::watchLive/);
  assert.doesNotMatch(home, /selectTab\(HostTab\.WATCH\)/);
  assert.doesNotMatch(watch, /"live:/);

  assert.match(host, /LivePlayerScreen\(/);
  assert.match(screen, /launchOnce\("start"\) \{ model\.start\(\) \}/);
});

// ---------------------------------------------------------------------------
// The picture, not a black rectangle
// ---------------------------------------------------------------------------

test("iPhone plays live HLS as a plain HTTPS asset, not through a resource loader", () => {
  const adapter = read(`${IOS}/Sources/FaithFormKit/Media/AVPlayerAdapter.swift`);
  const hls = adapter.slice(adapter.indexOf("case .hls:"), adapter.indexOf("case .progressive:"));

  // AVFoundation refuses HLS segments answered by a resource loader (-12881).
  assert.match(hls, /AVURLAsset\(url: request\.url\)/);
  assert.doesNotMatch(hls, /interceptScheme|resourceLoader/);
  // What the player does is observed, never assumed.
  assert.match(adapter, /observe\(\\\.status/);
  assert.match(adapter, /observe\(\\\.timeControlStatus/);
  assert.doesNotMatch(adapter, /handler\?\(\.playing\)\s*\n\s*case \.pause/);
  // With stall-waiting off, a stream played before it buffers stays black.
  assert.doesNotMatch(adapter, /automaticallyWaitsToMinimizeStalling = request\.kind/);
});

test("Android binds the video surface to the player it actually has", () => {
  const adapter = read(`${ANDROID}/media/Media3PlayerAdapter.kt`);
  const screen = read(`${ANDROID}/ui/media/LivePlayerScreen.kt`);
  const watch = read(`${ANDROID}/ui/media/WatchHost.kt`);

  // The player is created by the first Play, after the view exists; a view
  // bound once to a plain property stays bound to null.
  assert.match(adapter, /val videoPlayerState: StateFlow<Player\?>/);
  for (const source of [screen, watch]) {
    assert.match(source, /videoPlayerState\.collectAsStateWithLifecycle\(\)/);
    assert.match(source, /update = \{ view -> view\.player = player \}/);
    assert.doesNotMatch(source, /view\.player = adapter\.videoPlayer/);
  }
  // Falling behind the live window rejoins the edge instead of failing.
  assert.match(adapter, /ERROR_CODE_BEHIND_LIVE_WINDOW/);
});

test("a live grant addresses the stream by a delivery path", () => {
  const service = read("lib/media/v1/media-service.ts");
  assert.match(service, /issueMediaDeliveryToken\(/);
  assert.match(
    service,
    /`\/api\/media\/v1\/live\/\$\{encodedSlug\}\/\$\{encodedId\}\/\$\{delivery\.token\}\/index\.m3u8`/,
  );
});
