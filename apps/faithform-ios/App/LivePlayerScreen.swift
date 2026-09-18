import SwiftUI
import FaithFormKit

/// "Watch live", full screen, from wherever it was tapped.
///
/// Presented over the tabs by `RootView`. It builds one `LivePlayerModel` for
/// the presentation, points the church's shared player at it, and starts
/// playing at once; closing stops the stream, because a service still playing
/// behind the tabs is sound nobody can find the source of.
struct LivePlayerScreen: View {
    @Environment(\.scenePhase) private var scenePhase
    let features: ChurchFeatures
    let live: LiveMedia
    let onClose: @MainActor () -> Void

    @State private var model: LivePlayerModel?

    var body: some View {
        Group {
            if let model {
                LivePlayerView(
                    model: model,
                    player: features.player.videoPlayer,
                    live: live,
                    onClose: onClose
                )
            } else {
                Color.black.ignoresSafeArea()
            }
        }
        .task {
            guard model == nil else { return }
            let made = makeModel()
            model = made
            // The player is shared by the church's screens and only one is on
            // top, so whichever is showing hears it buffer, start and fail.
            await features.player.setEventHandler { event in
                Task { @MainActor in await made.handle(event) }
            }
            await made.start()
        }
        .onChange(of: scenePhase) { _, phase in
            guard let model else { return }
            switch phase {
            case .background: Task { await model.enterBackground() }
            case .active: Task { await model.enterForeground() }
            default: break
            }
        }
        .onDisappear {
            guard let model else { return }
            Task { await model.stop() }
        }
    }

    private func makeModel() -> LivePlayerModel {
        let media = features.media
        let mediaId = live.mediaId
        return LivePlayerModel(
            detail: features.mediaDetail(mediaId: mediaId),
            availability: {
                // The same projection Home and Watch draw from, so "has it
                // ended" here and the hero disappearing there are one answer.
                await media.refreshLive()
                guard case let .loaded(current, _, _) = media.phase else { return .unknown }
                guard let current, current.mediaId == mediaId, current.state == "live" else {
                    return .ended
                }
                return .live
            }
        )
    }
}
