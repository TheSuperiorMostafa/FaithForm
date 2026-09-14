import Testing
import Foundation
import SwiftUI
import UIKit
@testable import FaithForm
import FaithFormKit

/// Renders the automatic check-in screens, in light mode, from the shipping
/// views, for review.
///
/// Runs only when `FAITHFORM_SCREENSHOTS=1` reaches the host. The PNGs land in
/// the app's temporary directory under `attendance-shots/`, which a script
/// copies out of the simulator.
@MainActor
@Suite("Automatic check-in screens", .serialized)
struct AttendanceScreenshotTests {
    nonisolated static var enabled: Bool {
        // Or a flag file the driving script drops into the app's temporary
        // directory: `test-without-building` does not pass environment
        // variables through to a hosted Swift Testing run.
        ProcessInfo.processInfo.environment["FAITHFORM_SCREENSHOTS"] == "1"
            || FileManager.default.fileExists(
                atPath: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("faithform-screenshots.enabled").path
            )
    }

    private let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("attendance-shots")
    private let now = Date()

    @Test("setup screens", .enabled(if: enabled))
    func setup() async throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        try await render("01-intro", AutomaticAttendanceIntroView(onContinue: {}, onNotNow: {}))
        try await render(
            "02-education-when-in-use",
            LocationPermissionEducationView(
                title: L.autoAttendanceForegroundTitle,
                message: L.autoAttendanceForegroundBody,
                actionTitle: L.autoAttendanceContinue,
                onContinue: {}, onNotNow: {}
            )
        )
        try await render(
            "03-education-always",
            LocationPermissionEducationView(
                title: L.autoAttendanceBackgroundTitle,
                message: L.autoAttendanceBackgroundBody,
                actionTitle: L.autoAttendanceContinue,
                onContinue: {}, onNotNow: {}
            )
        )
        try await render(
            "04-education-notifications",
            LocationPermissionEducationView(
                title: L.autoAttendanceNotificationTitle,
                message: L.autoAttendanceNotificationBody,
                actionTitle: L.autoAttendanceContinue,
                onContinue: {}, onNotNow: {}
            )
        )
    }

    @Test("status on the Check in tab", .enabled(if: enabled))
    func status() async throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let next = AutomaticAttendanceModel.UpcomingService(
            label: "Sunday Worship",
            startsAt: now.addingTimeInterval(3 * 24 * 3600),
            checkinOpensAt: now.addingTimeInterval(3 * 24 * 3600 - 1800),
            isOpen: false
        )
        let last = AutomaticAttendanceModel.RecentCheckIn(
            occurrenceLabel: "Sunday Worship",
            countedAt: now.addingTimeInterval(-4 * 24 * 3600),
            wasAlreadyCounted: false
        )

        try await renderTab("05-status-off", AutomaticAttendanceStatus(step: .notStarted, isEnabled: false))
        try await renderTab(
            "06-status-on",
            AutomaticAttendanceStatus(
                step: .ready, isEnabled: true, monitoredRegionCount: 1,
                watchedChurchNames: ["Grace Community"], churchName: "Grace Community",
                nextService: next, lastCheckIn: last, now: now
            )
        )
        try await renderTab(
            "07-status-arrived-confirm",
            AutomaticAttendanceStatus(
                step: .ready, isEnabled: true, monitoredRegionCount: 1,
                watchedChurchNames: ["Grace Community"], churchName: "Grace Community",
                nextService: AutomaticAttendanceModel.UpcomingService(
                    label: "Sunday Worship", startsAt: now.addingTimeInterval(600),
                    checkinOpensAt: now.addingTimeInterval(-1200), isOpen: true
                ),
                lastCheckIn: last,
                pending: PendingArrival(
                    churchSlug: "grace", churchName: "Grace Community", occurrenceId: "o",
                    mode: .confirmation, promptAt: now.addingTimeInterval(-10),
                    needsPersonConfirmation: true, isQueued: false
                ),
                now: now
            )
        )
        try await renderTab(
            "08-status-needs-always",
            AutomaticAttendanceStatus(step: .blocked(.needsAlwaysAuthorization), isEnabled: true, churchName: "Grace Community")
        )
        try await renderTab(
            "09-status-precise-off",
            AutomaticAttendanceStatus(step: .blocked(.reducedAccuracy), isEnabled: true, churchName: "Grace Community")
        )
        try await renderTab(
            "10-status-no-people-link",
            AutomaticAttendanceStatus(step: .blocked(.noPeopleLink), isEnabled: false, churchName: "Grace Community")
        )
    }

    @Test("typing an unused character: the field shows what the model kept, and says why", .enabled(if: enabled))
    func typedCodeField() async throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let model = CheckInScannerModel(
            coordinator: CheckInScanCoordinator(camera: NoCamera(), submitter: NoSubmitter())
        )
        let window = try await show(
            NavigationStack {
                CheckInScannerScreen(model: model, onOpenSettings: {}, onDone: {})
                    .navigationTitle(L.checkinScanTitle)
                    .navigationBarTitleDisplayMode(.inline)
            }
        )
        defer { window.isHidden = true }

        let field = try #require(Self.textField(in: window), "no text field on the check-in screen")
        field.becomeFirstResponder()
        // One keystroke at a time, as a person types.
        for character in "ABC1234" {
            field.insertText(String(character))
            try await Task.sleep(for: .milliseconds(150))
        }
        try await Task.sleep(for: .milliseconds(600))

        #expect(model.typedCode == "BC34")
        #expect(field.text == "BC34", "the field shows \(field.text ?? "nil"), the model kept BC34")
        #expect(model.showsUnusedCharacterHint)
        #expect(!model.canSubmitTypedCode)
        field.resignFirstResponder()
        try await Task.sleep(for: .milliseconds(400))
        try snapshot(window, as: "11-typed-code-unused-characters")
        try Data("field=\(field.text ?? "nil") model=\(model.typedCode) hint=\(model.showsUnusedCharacterHint)".utf8)
            .write(to: directory.appendingPathComponent("11-typed-code-unused-characters.txt"))
    }

    private static func textField(in view: UIView) -> UITextField? {
        if let field = view as? UITextField { return field }
        for subview in view.subviews {
            if let found = textField(in: subview) { return found }
        }
        return nil
    }

    // MARK: -

    /// The status as the Check in tab shows it: its heading, under the title
    /// bar, in a scroll view.
    private func renderTab(_ name: String, _ status: AutomaticAttendanceStatus) async throws {
        try await render(
            name,
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                        Text(L.autoAttendanceTitle)
                            .font(.headline)
                        AutomaticAttendanceStatusView(
                            status: status,
                            onSetUp: {}, onResumeSetup: {}, onConfirm: {}, onDisable: {}, onOpenSettings: {}
                        )
                    }
                    .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                    .padding(.vertical, FaithFormTokens.Spacing.lg)
                }
                .navigationTitle(L.checkinScanTitle)
                .navigationBarTitleDisplayMode(.inline)
            }
        )
    }

    private func render<V: View>(_ name: String, _ view: V) async throws {
        let window = try await show(view)
        defer { window.isHidden = true }
        try snapshot(window, as: name)
    }

    private func show<V: View>(_ view: V) async throws -> UIWindow {
        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        )
        let window = UIWindow(windowScene: scene)
        window.overrideUserInterfaceStyle = .light
        window.frame = scene.screen.bounds
        let host = UIHostingController(
            rootView: view
                .faithformTheme()
                .environment(\.colorScheme, .light)
        )
        window.rootViewController = host
        window.makeKeyAndVisible()
        try await Task.sleep(for: .milliseconds(900))
        return window
    }

    private func snapshot(_ window: UIWindow, as name: String) throws {
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
        let image = renderer.image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let data = try #require(image.pngData())
        try data.write(to: directory.appendingPathComponent("\(name).png"))
    }
}

/// A camera that is never used: the typed field needs none.
private actor NoCamera: QrScanningFacade {
    func currentAuthorization() -> CameraAuthorization { .notDetermined }
    func requestAccess() async -> CameraAuthorization { .denied }
    func start(onCode: @Sendable @escaping (String) -> Void) async throws {}
    func stop() async {}
    func isAvailable() -> Bool { false }
}

private actor NoSubmitter: CheckInCodeSubmitting {
    func submit(_ submission: CheckInSubmission, idempotencyKey: String) async throws -> AttendanceResult {
        AttendanceResult(outcome: .rejected, message: "")
    }
}
