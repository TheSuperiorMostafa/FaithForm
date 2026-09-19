import SwiftUI
import FaithFormKit

/// Kept beside the content, so going back returns to the same sermon or slide.
struct RelatedServices: View {
    let features: ChurchFeatures
    let services: [LinkedService]

    var body: some View {
        if !services.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(services, id: \.mediaId) { service in
                        NavigationLink {
                            AnyView(LinkedServiceScreen(features: features, service: service))
                        } label: {
                            Label("\(service.kind == "live" ? L.mediaWatchLive : L.mediaWatchRecording) · \(service.title)",
                                  systemImage: service.kind == "live" ? "dot.radiowaves.left.and.right" : "play.rectangle")
                                .font(.subheadline.weight(.semibold))
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}

private struct LinkedServiceScreen: View {
    @Environment(\.dismiss) private var dismiss
    let features: ChurchFeatures
    let service: LinkedService
    @State private var replayId: String?
    @State private var live: LiveMedia?
    @State private var loading = true

    var body: some View {
        Group {
            if service.kind == "recording" {
                AnyView(RecordingScreen(features: features, mediaId: service.mediaId))
            } else if let replayId {
                AnyView(RecordingScreen(features: features, mediaId: replayId))
            } else if let live {
                LivePlayerScreen(features: features, live: live, onClose: { dismiss() })
                    .toolbar(.hidden, for: .navigationBar, .tabBar)
            } else if loading {
                ProgressView()
            } else {
                ContentUnavailableView(L.mediaLiveEnded, systemImage: "video.slash", description: Text(L.mediaReturnForRecording))
            }
        }
        .task {
            guard service.kind == "live" else { return }
            await features.media.refreshLive()
            if case let .loaded(current, _, _) = features.media.phase,
               let current, current.mediaId == service.mediaId {
                if current.state == "live" { live = current }
                else { replayId = current.replayMediaId }
            }
            loading = false
        }
    }
}

struct ServicePresentationSheet: View {
    @Environment(\.dismiss) private var dismiss
    let features: ChurchFeatures
    let presentationId: String
    var body: some View {
        NavigationStack {
            PresentationScreen(features: features, presentationId: presentationId, showsLinkedServices: false)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(L.mediaBackToService) { dismiss() }
                    }
                }
        }
    }
}
