import SwiftUI
import UIKit
import FaithFormKit

/// Check in: scan the code on the screen at church, or type it.
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
struct CheckInTabView: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.openURL) private var openURL
    let root: RootModel
    let features: ChurchFeatures
    let isStale: Bool

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
                        .frame(height: 240)
                        .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous))
                        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                        .padding(.top, FaithFormTokens.Spacing.base)
                }

                CheckInScannerScreen(
                    model: model,
                    onOpenSettings: {
                        // Only offered for a camera the person denied — see
                        // `CheckInScannerModel.offersSettings`.
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            openURL(url)
                        }
                    },
                    onDone: {
                        Task { await model.reset() }
                        root.select(.home)
                    }
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .navigationTitle(L.checkinScanTitle)
            .navigationBarTitleDisplayMode(.inline)
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

    /// Scanning, or sending what was scanned. Never true before a tap.
    nonisolated static func awaitsScan(_ phase: ScanPhase) -> Bool {
        switch phase {
        case .scanning, .submitting: return true
        default: return false
        }
    }
}
