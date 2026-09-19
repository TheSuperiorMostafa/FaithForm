import Foundation

/// Strings for the redesigned Watch player (P15). Kept beside `Strings.swift`
/// rather than inside it so it can land independently; the keys match
/// Android's `values/strings_media_player.xml` one for one.
extension L {
    public static var mediaOpenPresentation: String { t("media_open_presentation", "Open sermon presentation") }
    public static var mediaWatchRecording: String { t("media_watch_recording", "Watch recording") }
    public static var mediaBackToService: String { t("media_back_to_service", "Back to service") }
    public static var mediaReturnForRecording: String { t("media_return_for_recording", "Return to the sermon for the published recording.") }

    public static var mediaLiveShort: String { t("media_live_short", "LIVE") }
    public static var mediaFullScreen: String { t("media_full_screen", "Full screen") }
    public static var mediaExitFullScreen: String { t("media_exit_full_screen", "Exit full screen") }
    public static var mediaSkipBack: String { t("media_skip_back", "Back 15 seconds") }
    public static var mediaSkipForward: String { t("media_skip_forward", "Forward 15 seconds") }
    public static var mediaWatchReplay: String { t("media_watch_replay", "Watch the replay") }
    public static var mediaReplayAvailable: String { t("media_replay_available", "Replay available") }
    public static var mediaWatchingLive: String { t("media_watching_live", "Streaming live now") }
    public static var mediaLoadingVideo: String { t("media_loading_video", "Loading video") }
    public static var mediaPlaybackPosition: String { t("media_playback_position", "Playback position") }
    public static var mediaPlayService: String { t("media_play_service", "Play service") }
}
