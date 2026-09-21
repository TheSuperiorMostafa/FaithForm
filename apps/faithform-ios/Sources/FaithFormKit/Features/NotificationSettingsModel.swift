import Foundation
import Observation

/// What a person may be told about, per church.
///
/// The server stores a row only for a topic somebody has turned **off**:
/// absent means "not yet decided", which is the topic's default rather than
/// consent it never gave. So this model starts every topic on, overlays what
/// came back, and sends a row only when someone changes one — which keeps
/// "I have never opened this screen" and "I want everything" the same state.
///
/// The topics are the two the server publishes against. A service going live
/// and a new recording are enqueued under `events`, so the events switch
/// covers them too; group and message notifications are separate, and live on
/// the group's own screen where the choice is per conversation.
@Observable
@MainActor
public final class NotificationSettingsModel {
    /// One church, with a switch per topic.
    public struct ChurchTopics: Identifiable, Sendable, Equatable {
        public let slug: String
        public let name: String
        public var announcements: Bool
        public var events: Bool
        public var id: String { slug }
    }

    public private(set) var churches: [ChurchTopics] = []
    public private(set) var loading = false
    public private(set) var saving = false
    public var error: String?

    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// Reads the stored opt-outs and applies them over an all-on default.
    ///
    /// `churches` is supplied by the caller rather than fetched: the account
    /// already knows which churches it has, and a preference for a church that
    /// is no longer in that list is not a switch anyone can act on.
    public func load(churches: [(slug: String, name: String)]) async {
        loading = churches.isEmpty ? false : churches.count != self.churches.count
        defer { loading = false }
        var topics = churches.map {
            ChurchTopics(slug: $0.slug, name: $0.name, announcements: true, events: true)
        }
        do {
            let stored = try await api.send("api/mobile/v1/preferences", as: NotificationPreferenceList.self)
            for preference in stored.value?.items ?? [] {
                guard let index = topics.firstIndex(where: { $0.slug == preference.churchSlug }) else { continue }
                switch preference.topic {
                case .announcements: topics[index].announcements = preference.isEnabled
                case .events: topics[index].events = preference.isEnabled
                case .unknown: continue
                }
            }
            self.churches = topics
            error = nil
        } catch is CancellationError {
        } catch {
            // The switches still render, at their defaults. A screen that
            // cannot read its own state is better than an empty one, and the
            // next change writes the truth.
            if self.churches.isEmpty { self.churches = topics }
            self.error = Self.message(error)
        }
    }

    /// Writes one switch. The local value moves first and rolls back if the
    /// server refuses, so a switch never sits somewhere the server is not.
    public func set(_ topic: NotificationTopic, for slug: String, enabled: Bool) async {
        guard let index = churches.firstIndex(where: { $0.slug == slug }) else { return }
        let previous = churches[index]
        switch topic {
        case .announcements: churches[index].announcements = enabled
        case .events: churches[index].events = enabled
        case .unknown: return
        }
        saving = true
        defer { saving = false }
        do {
            _ = try await api.send(
                "api/mobile/v1/preferences",
                method: .put,
                body: SetPreferenceRequest(churchSlug: slug, topic: topic, isEnabled: enabled),
                as: NotificationPreference.self
            )
            error = nil
        } catch is CancellationError {
            churches[index] = previous
        } catch {
            churches[index] = previous
            self.error = Self.message(error)
        }
    }

    static func message(_ error: Error) -> String {
        (error as? APIError)?.displayMessage ?? "Something went wrong. Please try again."
    }
}

/// The list `GET /api/mobile/v1/preferences` returns.
public struct NotificationPreferenceList: Codable, Hashable, Sendable {
    public let items: [NotificationPreference]
    public init(items: [NotificationPreference]) { self.items = items }
}
