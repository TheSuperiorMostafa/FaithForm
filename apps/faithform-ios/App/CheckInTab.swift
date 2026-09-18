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
    let features: ChurchFeatures
    let attendance: AutomaticAttendanceModel
    let isStale: Bool

    /// The setup sheet, opened only by a tap here.
    @State private var settingUp = false

    var body: some View {
        let model = features.checkIn

        NavigationStack {
            VStack(spacing: 0) {
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
                        .shadow(
                            color: theme.palette.brandPrimary.opacity(0.15),
                            radius: 8,
                            y: 4
                        )
                        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                        .padding(.top, FaithFormTokens.Spacing.base)
                }

                CheckInScannerScreen(
                    model: model,
                    onOpenSettings: {
                        // Only offered for a camera the person denied — see
                        // `CheckInScannerModel.offersSettings`.
                        openSettings()
                    },
                    onDone: {
                        Task { await model.reset() }
                        root.select(.home)
                    },
                    footer: AnyView(
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
                    )
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .navigationTitle(L.checkinScanTitle)
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
                await attendance.holdOpenUntilDue()
            }
            // A scanned code is handled by the coordinator on the camera's own
            // callback, which the model does not observe. While a scan the
            // person started is in progress, ask for its outcome a few times a
            // second; the task ends, and stops asking, the moment it has one.
            .task(id: Self.awaitsScan(model.phase)) {
                guard Self.awaitsScan(model.phase) else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(250))
                    await model.refresh()
                    if !Self.awaitsScan(model.phase) { return }
                }
            }
        }
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
                onDisable: { Task { await model.disable() } },
                onOpenSettings: onOpenSettings
            )
        }
        .padding(.top, FaithFormTokens.Spacing.md)
    }
}
