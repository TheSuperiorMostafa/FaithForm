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
    @Environment(\.faithfulTheme) private var theme
    @Bindable private var model: CheckInScannerModel

    private let onOpenSettings: @MainActor () -> Void
    private let onDone: @MainActor () -> Void

    public init(
        model: CheckInScannerModel,
        onOpenSettings: @escaping @MainActor () -> Void,
        onDone: @escaping @MainActor () -> Void
    ) {
        self.model = model
        self.onOpenSettings = onOpenSettings
        self.onDone = onDone
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                header

                switch model.phase {
                case .idle, .requestingPermission:
                    scanOffer
                    typedEntry
                case .scanning:
                    ScanningIndicator()
                    typedEntry
                case .submitting:
                    SubmittingIndicator()
                case .finished:
                    resultCard
                case .blocked:
                    blockCard
                    typedEntry
                }
            }
            .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithfulTokens.Spacing.xl)
        }
        .background(theme.palette.background)
        // Releases the camera when the screen goes away. A scanner left running
        // behind another screen is a camera indicator nobody can explain.
        .onDisappear { Task { await model.stopScanning() } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            Text(L.checkinScanIntroTitle)
                .font(theme.font(FaithfulTokens.Text.displayLarge))
                .foregroundStyle(theme.palette.contentPrimary)
            Text(L.checkinScanIntroBody)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(L.checkinScanPrivacyNote)
                .font(theme.font(FaithfulTokens.Text.caption))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var scanOffer: some View {
        Button(L.checkinScanButton) {
            Task { await model.startScanning() }
        }
        .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
    }

    private var typedEntry: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                Text(L.checkinScanCodeTitle)
                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(L.checkinScanCodeHint)
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)

                TextField(L.checkinScanCodeLabel, text: $model.typedCode)
                    .font(theme.font(FaithfulTokens.Text.displayLarge))
                    .checkInCodeFieldStyling()
                    .accessibilityLabel(L.checkinScanCodeLabel)

                Button(L.checkinScanCodeSubmit) {
                    Task { await model.submitTypedCode() }
                }
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                .disabled(!model.canSubmitTypedCode)
            }
        }
    }

    private var resultCard: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                Text(model.resultMessage ?? "")
                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                    .foregroundStyle(
                        model.resultIsSuccess
                            ? theme.palette.contentPrimary
                            : theme.palette.contentSecondary
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    // Announced as soon as it appears: a person holding a phone
                    // up at a screen is not looking at the phone.
                    .accessibilityAddTraits(.isStaticText)

                if model.resultIsSuccess {
                    Button(L.checkinScanDone, action: onDone)
                        .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                } else {
                    Button(L.checkinScanTryAgain) {
                        Task { await model.reset() }
                    }
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var blockCard: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                Text(model.blockTitle ?? "")
                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(model.blockBody ?? "")
                    .font(theme.font(FaithfulTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if model.offersSettings {
                    Button(L.checkinScanOpenSettings, action: onOpenSettings)
                        .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
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
    @Environment(\.faithfulTheme) private var theme

    var body: some View {
        HStack(spacing: FaithfulTokens.Spacing.sm) {
            ProgressView()
            Text(L.checkinScanSearching)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct SubmittingIndicator: View {
    @Environment(\.faithfulTheme) private var theme

    var body: some View {
        HStack(spacing: FaithfulTokens.Spacing.sm) {
            ProgressView()
            Text(L.checkinScanSubmitting)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
        }
        .accessibilityElement(children: .combine)
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
