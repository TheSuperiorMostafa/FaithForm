import SwiftUI
import UIKit
import FaithFormKit

/// Notifications, from Account: what this phone may be told, and by whom.
///
/// The page is the education screen as well as the settings screen. Nothing
/// here prompts on appearance — the system prompt is behind the one button,
/// which is the same rule automatic check-in and location follow, and the
/// reason it can be read before anything is decided.
struct NotificationSettingsScreen: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    let push: PushLifecycleModel
    let api: APIClient
    /// The churches this account can be told about — the same test the rest of
    /// the app uses for "a church whose content you may read".
    let churches: [(slug: String, name: String)]

    @State private var settings: NotificationSettingsModel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                permissionPanel
                if push.status == .authorized || push.status == .provisional {
                    topicsPanel
                }
            }
            .padding(FaithFormTokens.Layout.screenPaddingHorizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await push.refreshStatus()
            let model = settings ?? NotificationSettingsModel(api: api)
            settings = model
            await model.load(churches: churches)
        }
        // Someone who turned notifications on in Settings comes back to a page
        // that already knows, rather than to a stale "off".
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await push.refreshStatus() }
        }
    }

    @ViewBuilder private var permissionPanel: some View {
        GroupPanelView("On this iPhone") {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                Text(statusTitle)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(statusBody)
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if push.status == .notDetermined {
                    Button("Turn on notifications") {
                        Task {
                            // Education first, then the prompt — the model
                            // refuses the prompt in the other order.
                            await push.beginEducation()
                            await push.confirmEnable()
                        }
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                } else if NotificationPrompting.shouldDirectToSettings(push.status) {
                    // iOS asks once. From here on it is Settings or nothing,
                    // and saying so is better than a button that does nothing.
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                }

                if let error = push.registrationError {
                    Text(error)
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.destructive)
                }
            }
        }
    }

    @ViewBuilder private var topicsPanel: some View {
        if let settings, !settings.churches.isEmpty {
            GroupPanelView("What you're told about") {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                    ForEach(settings.churches) { church in
                        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                            Text(church.name)
                                .font(theme.font(FaithFormTokens.Text.label))
                                .foregroundStyle(theme.palette.contentPrimary)
                            Toggle("Announcements", isOn: Binding(
                                get: { church.announcements },
                                set: { value in
                                    Task { await settings.set(.announcements, for: church.slug, enabled: value) }
                                }
                            ))
                            .font(theme.font(FaithFormTokens.Text.body))
                            Toggle("Events, live services and recordings", isOn: Binding(
                                get: { church.events },
                                set: { value in
                                    Task { await settings.set(.events, for: church.slug, enabled: value) }
                                }
                            ))
                            .font(theme.font(FaithFormTokens.Text.body))
                        }
                        if church.id != settings.churches.last?.id {
                            Divider().overlay(theme.palette.divider)
                        }
                    }
                    Text("Messages in a group are set on that group's own screen.")
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)
                    if let error = settings.error {
                        Text(error)
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.palette.destructive)
                    }
                }
            }
        }
    }

    private var statusTitle: String {
        switch push.status {
        case .authorized, .ephemeral: return "Notifications are on"
        case .provisional: return "Notifications arrive quietly"
        case .denied: return "Notifications are off"
        case .notDetermined: return "Notifications are off"
        }
    }

    private var statusBody: String {
        switch push.status {
        case .authorized, .ephemeral:
            return "Your churches can tell you about announcements, events and services going live. Choose what you hear about below."
        case .provisional:
            return "They appear in your notification centre without a sound. Turn on alerts in Settings to be told as they arrive."
        case .denied:
            return "iOS only asks once. You can turn notifications back on for FaithForm in Settings."
        case .notDetermined:
            return "Turn these on and your churches can tell you when something is announced, when an event changes, and when a service goes live. You choose which churches, and you can turn them off at any time."
        }
    }
}
