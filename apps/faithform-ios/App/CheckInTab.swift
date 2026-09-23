import SwiftUI
import UIKit
import FaithFormKit

/// Check in: scan the code on the screen at church, or type it — and, below
/// both, automatic check-in.
///
/// ## The camera rule, and what keeps it
///
/// **Opening this tab starts nothing.** `CheckInScannerScreen` opens idle with
/// the typed-code field ready, and the camera is asked for only when the person
/// taps "Scan the code" — `CheckInScannerModel.startScanning()` is the one path
/// to a prompt. Nothing here calls it: this host adds a viewfinder while the
/// scanner is already running, and polls for the result of a scan the person
/// started, and neither can begin one. A deep link to this tab therefore cannot
/// raise a permission prompt either.
///
/// ## The same rule for location
///
/// Automatic check-in's status is shown here, and its setup opens only from a
/// tap on "Turn on automatic check-in". Reading the status raises nothing.
struct CheckInTabView: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.openURL) private var openURL
    let root: RootModel
    let dependencies: AppDependencies
    let features: ChurchFeatures
    let attendance: AutomaticAttendanceModel
    let isStale: Bool

    /// The setup sheet, opened only by a tap here.
    @State private var settingUp = false

    private var showsAutomaticCheckIn: Bool {
        root.selectedChurch?.automaticCheckInEnabled ?? true
    }

    private var showsCodeCheckIn: Bool {
        root.selectedChurch?.codeCheckInEnabled ?? true
    }

    var body: some View {
        NavigationStack {
            checkInContent
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .navigationTitle(showsCodeCheckIn ? L.checkinScanTitle : L.autoAttendanceTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: FaithFormTokens.Spacing.sm) {
                        if let church = root.selectedChurch {
                            ChurchAvatar(logoUrl: church.logoUrl, name: church.churchName, size: 28)
                            Text(church.churchName)
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                                .lineLimit(1)
                        } else {
                            Text(L.checkinScanTitle)
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                        }
                    }
                }
            }
            .sheet(isPresented: $settingUp, onDismiss: {
                // Swiped away part-way: the same as "Not now" on that screen.
                if attendance.step.isSetup { Task { await attendance.notNow() } }
            }) {
                AutomaticAttendanceFlowView(
                    model: attendance,
                    onOpenSettings: openSettings,
                    onRequestConfirmation: { await requestPeopleConfirmation() },
                    onClose: { settingUp = false }
                )
                .faithformTheme(root.selectedChurch?.appTheme)
                // Never while consent or a permission answer is in flight.
                .interactiveDismissDisabled(attendance.isWorking || attendance.step == .requestingConsent)
            }
            // Setup ends in a status, and the status lives on this tab.
            .onChange(of: attendance.step) { _, step in
                if settingUp, !step.isSetup { settingUp = false }
            }
            .task(id: features.churchSlug) {
                guard showsAutomaticCheckIn else { return }
                await attendance.select(
                    church: AttendanceChurch(
                        slug: features.churchSlug,
                        name: root.selectedChurch?.churchName
                    )
                )
            }
            // An arrival due within a few minutes is finished while this screen
            // is open, rather than waiting for a notification.
            .task(id: attendance.pending?.promptAt) {
                guard showsAutomaticCheckIn else { return }
                await attendance.holdOpenWhilePending()
            }
        }
    }

    private func requestPeopleConfirmation() async -> String? {
        guard let slug = root.selectedChurch?.churchSlug else { return L.autoAttendanceOfflineBody }
        do {
            let result = try await APIPeopleClaimRequester(api: dependencies.api).requestConfirmation(churchSlug: slug)
            return result.isLinked ? L.autoAttendanceConfirmationAlreadyLinked : L.autoAttendanceConfirmationRequested
        } catch let error as APIError {
            return error.displayMessage.isEmpty ? L.autoAttendanceConfirmationFailed : error.displayMessage
        } catch {
            return L.autoAttendanceConfirmationFailed
        }
    }

    @ViewBuilder
    private var checkInContent: some View {
        if showsCodeCheckIn {
            codeCheckInContent
        } else if showsAutomaticCheckIn {
            VStack(spacing: 0) {
                if isStale { OfflineBanner(message: L.offlineCached) }
                ScrollView {
                    AutomaticCheckInSection(
                        model: attendance,
                        onSetUp: {
                            attendance.begin()
                            settingUp = true
                        },
                        onResumeSetup: {
                            settingUp = true
                            Task { await attendance.resumeSetup() }
                        },
                        onOpenSettings: openSettings
                    )
                    .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                    .padding(.vertical, FaithFormTokens.Spacing.lg)
                }
            }
        }
    }

    private var codeCheckInContent: some View {
        let model = features.checkIn
        return VStack(spacing: 0) {
            if isStale { OfflineBanner(message: L.offlineCached) }

            if case .scanning = model.phase {
                // A viewfinder, so a person can see what they are pointing
                // at. Inert by construction: it displays a session the
                // scanner already started and cannot start, stop or read it.
                CheckInCameraPreview(session: features.scanner.previewSession)
                    .frame(maxWidth: .infinity)
                    .frame(height: 250)
                    .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous)
                            .strokeBorder(theme.palette.brandAccent, lineWidth: FaithFormTokens.BorderWidth.emphasis)
                    )
                    .shadow(color: theme.palette.brandPrimary.opacity(0.15), radius: 8, y: 4)
                    .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                    .padding(.top, FaithFormTokens.Spacing.base)
            }

            CheckInScannerScreen(
                model: model,
                onOpenSettings: openSettings,
                onDone: {
                    Task { await model.reset() }
                    root.select(.home)
                },
                footer: showsAutomaticCheckIn ? AnyView(automaticCheckInSection) : nil
            )
        }
        // A scanned code is handled by the coordinator on the camera's own
        // callback. Poll only while the church actually offers code check-in.
        .task(id: Self.awaitsScan(model.phase)) {
            guard Self.awaitsScan(model.phase) else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                await model.refresh()
                if !Self.awaitsScan(model.phase) { return }
            }
        }
    }

    private var automaticCheckInSection: some View {
        AutomaticCheckInSection(
            model: attendance,
            onSetUp: {
                attendance.begin()
                settingUp = true
            },
            onResumeSetup: {
                settingUp = true
                Task { await attendance.resumeSetup() }
            },
            onOpenSettings: openSettings
        )
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            openURL(url)
        }
    }

    /// Scanning, or sending what was scanned. Never true before a tap.
    nonisolated static func awaitsScan(_ phase: ScanPhase) -> Bool {
        switch phase {
        case .scanning, .submitting: return true
        default: return false
        }
    }
}

/// Automatic check-in, below the scanner.
///
/// The status and its one next step. Setup opens in a sheet from here; turning
/// it off, opening Settings and the in-app "Check in" all act in place.
struct AutomaticCheckInSection: View {
    @Environment(\.faithformTheme) private var theme
    let model: AutomaticAttendanceModel
    let onSetUp: @MainActor () -> Void
    let onResumeSetup: @MainActor () -> Void
    let onOpenSettings: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            HStack(spacing: FaithFormTokens.Spacing.sm) {
                Image(systemName: "location.circle.fill")
                    .font(.system(size: FaithFormTokens.IconSize.sizeLarge))
                    .foregroundStyle(theme.palette.brandAccent)
                Text(L.autoAttendanceTitle)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
            }
            .accessibilityAddTraits(.isHeader)

            AutomaticAttendanceStatusView(
                status: model.status,
                onSetUp: onSetUp,
                onResumeSetup: onResumeSetup,
                onConfirm: { Task { await model.confirmCheckIn() } },
                onDecline: { Task { await model.declineArrival() } },
                onDisable: { Task { await model.disable() } },
                onOpenSettings: onOpenSettings
            )
        }
        .padding(.top, FaithFormTokens.Spacing.md)
    }
}
