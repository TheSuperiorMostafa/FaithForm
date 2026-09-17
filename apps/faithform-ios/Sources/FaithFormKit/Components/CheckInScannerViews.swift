import SwiftUI

/// The check-in scanner.
///
/// ## Why the typed field is on the first screen
///
/// It is not a fallback that appears after something has failed. Someone whose
/// camera is broken, whose hands shake, who uses a device with no rear camera,
/// or who simply does not want to grant camera access should not have to be
/// refused once before they are shown the way that works for them. Both options
/// are offered together, and neither is described as the lesser one.
///
/// ## Why nothing here can raise a prompt
///
/// Every view below reports an intent upward. `CheckInScannerModel` is the only
/// thing that calls the coordinator, and the coordinator is the only thing that
/// holds a camera. `onAppear` starts nothing.

public struct CheckInScannerScreen: View {
    public enum Mode: Hashable, Sendable {
        case scan
        case code
    }

    @Environment(\.faithformTheme) private var theme
    @Bindable private var model: CheckInScannerModel

    private let onOpenSettings: @MainActor () -> Void
    private let onDone: @MainActor () -> Void
    private let footer: AnyView?
    /// What the code field shows. Kept in step with `model.typedCode` both ways.
    @State private var codeText = ""
    @State private var selectedMode: Mode = .scan

    /// `footer` is placed below the scanner whenever no scan is running — the
    /// host puts automatic check-in there, beside the manual way in rather
    /// than instead of it.
    public init(
        model: CheckInScannerModel,
        onOpenSettings: @escaping @MainActor () -> Void,
        onDone: @escaping @MainActor () -> Void,
        footer: AnyView? = nil
    ) {
        self.model = model
        self.onOpenSettings = onOpenSettings
        self.onDone = onDone
        self.footer = footer
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                header

                // Mode switcher between Scan and Code entry
                if !CheckInScannerScreen.isBusy(model.phase) && !isFinished {
                    FaithFormPillSwitcher(
                        selection: $selectedMode,
                        options: [
                            .init(.scan, title: L.checkinScanButton),
                            .init(.code, title: L.checkinScanEnterCode)
                        ],
                        accessibilityLabel: L.checkinScanTitle
                    )
                    .padding(.bottom, FaithFormTokens.Spacing.xs)
                }

                switch model.phase {
                case .idle, .requestingPermission:
                    if selectedMode == .scan {
                        scanCard
                    } else {
                        typedEntryCard
                    }
                case .scanning:
                    activeScanningCard
                case .submitting:
                    submittingCard
                case .finished:
                    resultCard
                case .blocked:
                    blockCard
                    if selectedMode == .code {
                        typedEntryCard
                    }
                }

                if let footer, !CheckInScannerScreen.isBusy(model.phase) && !isFinished {
                    footer
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.lg)
        }
        .background(theme.palette.background)
        // Releases the camera when the screen goes away. A scanner left running
        // behind another screen is a camera indicator nobody can explain.
        .onDisappear { Task { await model.stopScanning() } }
    }

    private var isFinished: Bool {
        if case .finished = model.phase { return true }
        return false
    }

    /// Scanning or sending: nothing else competes for the screen.
    static func isBusy(_ phase: ScanPhase) -> Bool {
        switch phase {
        case .scanning, .submitting: return true
        default: return false
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
            HStack(spacing: FaithFormTokens.Spacing.sm) {
                Image(systemName: "person.badge.shield.checkmark.fill")
                    .font(.system(size: FaithFormTokens.IconSize.sizeLarge))
                    .foregroundStyle(theme.palette.brandAccent)
                Text(L.checkinScanTitle)
                    .font(theme.font(FaithFormTokens.Text.displayLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
            }

            Text(L.checkinScanIntroBody)
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .lineLimit(3)
        }
    }

    private var scanCard: some View {
        FaithFormCard {
            VStack(spacing: FaithFormTokens.Spacing.lg) {
                ZStack {
                    RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous)
                        .fill(theme.palette.surfaceSunken)
                        .frame(height: 180)

                    VStack(spacing: FaithFormTokens.Spacing.sm) {
                        Image(systemName: "qrcode.viewfinder")
                            .font(.system(size: 48, weight: .light))
                            .foregroundStyle(theme.palette.brandPrimary)

                        Text(L.checkinScanIntroTitle)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)

                        Text(L.checkinScanPrivacyNote)
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.palette.contentMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, FaithFormTokens.Spacing.base)
                    }
                }

                Button {
                    Task { await model.startScanning() }
                } label: {
                    Label(L.checkinScanButton, systemImage: "camera.fill")
                }
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            }
        }
    }

    private var activeScanningCard: some View {
        FaithFormCard {
            VStack(spacing: FaithFormTokens.Spacing.md) {
                ScanningIndicator()

                Button(L.topicEvents.isEmpty ? "Stop Scanning" : L.checkinScanTryAgain) {
                    Task { await model.stopScanning() }
                }
                .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, FaithFormTokens.Spacing.sm)
        }
    }

    private var submittingCard: some View {
        FaithFormCard {
            VStack(spacing: FaithFormTokens.Spacing.md) {
                SubmittingIndicator()
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, FaithFormTokens.Spacing.xl)
        }
    }

    private var typedEntryCard: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    Image(systemName: "character.textbox")
                        .font(.system(size: FaithFormTokens.IconSize.sizeLarge))
                        .foregroundStyle(theme.palette.brandAccent)
                    Text(L.checkinScanCodeTitle)
                        .font(theme.font(FaithFormTokens.Text.titleMedium))
                        .foregroundStyle(theme.palette.contentPrimary)
                }

                Text(L.checkinScanCodeHint)
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)

                // Bound to local text, not to the model: the model normalises
                // as the person types, and a field bound straight to it went on
                // showing what was typed rather than what the model kept.
                TextField(L.checkinScanCodeLabel, text: $codeText)
                    .font(theme.font(FaithFormTokens.Text.displayLarge))
                    .multilineTextAlignment(.center)
                    .tracking(6)
                    .padding(FaithFormTokens.Spacing.md)
                    .background(
                        RoundedRectangle(cornerRadius: FaithFormTokens.Radius.control, style: .continuous)
                            .fill(theme.palette.surfaceSunken)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: FaithFormTokens.Radius.control, style: .continuous)
                            .strokeBorder(theme.palette.border, lineWidth: theme.borderWidth)
                    )
                    .checkInCodeFieldStyling()
                    .accessibilityLabel(L.checkinScanCodeLabel)
                    .onAppear { codeText = model.typedCode }
                    .onChange(of: codeText) { _, typed in
                        let kept = model.editTypedCode(typed)
                        if kept != typed { codeText = kept }
                    }
                    // Cleared by the model after a check-in or a reset.
                    .onChange(of: model.typedCode) { _, kept in
                        if kept != codeText { codeText = kept }
                    }

                if model.showsUnusedCharacterHint {
                    HStack(alignment: .top, spacing: FaithFormTokens.Spacing.xs) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: FaithFormTokens.IconSize.sizeSmall))
                            .foregroundStyle(theme.palette.warning)
                        Text(L.checkinCodeInvalidCharacters)
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.palette.contentPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityIdentifier("checkin-code-unused-characters")
                }

                Button {
                    Task { await model.submitTypedCode() }
                } label: {
                    Label(L.checkinScanCodeSubmit, systemImage: "checkmark.circle.fill")
                }
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                .disabled(!model.canSubmitTypedCode)
            }
        }
    }

    private var resultCard: some View {
        FaithFormCard {
            VStack(spacing: FaithFormTokens.Spacing.lg) {
                Image(systemName: model.resultIsSuccess ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(model.resultIsSuccess ? theme.palette.success : theme.palette.destructive)

                VStack(spacing: FaithFormTokens.Spacing.xs) {
                    Text(model.resultIsSuccess ? L.checkinScanTitle : L.errorTitle)
                        .font(theme.font(FaithFormTokens.Text.titleLarge))
                        .foregroundStyle(theme.palette.contentPrimary)

                    Text(model.resultMessage ?? "")
                        .font(theme.font(FaithFormTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isStaticText)
                }

                if model.resultIsSuccess {
                    Button(action: onDone) {
                        Label(L.checkinScanDone, systemImage: "arrow.right.circle.fill")
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                } else {
                    Button {
                        Task { await model.reset() }
                    } label: {
                        Label(L.checkinScanTryAgain, systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, FaithFormTokens.Spacing.base)
        }
        .accessibilityElement(children: .contain)
    }

    private var blockCard: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    Image(systemName: "video.slash.fill")
                        .font(.system(size: FaithFormTokens.IconSize.sizeLarge))
                        .foregroundStyle(theme.palette.warning)
                    Text(model.blockTitle ?? "")
                        .font(theme.font(FaithFormTokens.Text.titleMedium))
                        .foregroundStyle(theme.palette.contentPrimary)
                }

                Text(model.blockBody ?? "")
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if model.offersSettings {
                    Button(action: onOpenSettings) {
                        Label(L.checkinScanOpenSettings, systemImage: "gearshape.fill")
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                }
            }
        }
    }
}

private extension View {
    /// Turns off every keyboard convenience that would fight the alphabet.
    ///
    /// The code has no lowercase, no vowels, and no punctuation, so
    /// autocapitalisation, autocorrection and smart quotes can only get in the
    /// way. `textInputAutocapitalization` is iOS-only, hence the guard — the
    /// package builds on macOS so its logic stays testable there.
    @ViewBuilder
    func checkInCodeFieldStyling() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.characters)
            .autocorrectionDisabled(true)
        #else
        self.autocorrectionDisabled(true)
        #endif
    }
}

private struct ScanningIndicator: View {
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        FaithFormWorkingLabel(L.checkinScanSearching, working: true)
            .font(theme.font(FaithFormTokens.Text.body))
            .foregroundStyle(theme.palette.contentSecondary)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(L.checkinScanSearching)
    }
}

private struct SubmittingIndicator: View {
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        FaithFormWorkingLabel(L.checkinScanSubmitting, working: true)
            .font(theme.font(FaithFormTokens.Text.body))
            .foregroundStyle(theme.palette.contentSecondary)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(L.checkinScanSubmitting)
    }
}

#if os(iOS)
import AVFoundation

/// The live camera preview.
///
/// Separated behind `#if os(iOS)` because it is UIKit, and kept deliberately
/// inert: it displays a session someone else started and owns nothing. It
/// cannot start the camera, cannot stop it, and has no access to frames — so a
/// preview left on screen by a layout mistake cannot leave a camera running.
public struct CheckInCameraPreview: UIViewRepresentable {
    private let session: AVCaptureSession

    public init(session: AVCaptureSession) {
        self.session = session
    }

    public func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        view.isAccessibilityElement = true
        view.accessibilityLabel = L.checkinScanSearching
        return view
    }

    public func updateUIView(_ uiView: PreviewView, context: Context) {}

    public final class PreviewView: UIView {
        public override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer {
            // Safe: `layerClass` guarantees the type.
            layer as! AVCaptureVideoPreviewLayer
        }
    }
}
#endif
