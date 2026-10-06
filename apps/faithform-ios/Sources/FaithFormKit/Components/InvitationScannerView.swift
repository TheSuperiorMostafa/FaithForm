#if os(iOS)
import SwiftUI

/// The existing QR camera reads strings only; an invitation is never redeemed
/// until the person returns to the confirmation form and chooses Join.
struct InvitationScannerView: View {
    @Environment(\.dismiss) private var dismiss
    let onToken: @MainActor (String) -> Void
    @State private var scanner = AVFoundationScanner()
    @State private var message = "Point your camera at your church’s invitation QR code."
    @State private var scanning = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text(message).padding().multilineTextAlignment(.center)
                if scanning {
                    CheckInCameraPreview(session: scanner.previewSession)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .padding(.horizontal)
                }
                Spacer(minLength: 0)
            }
            .navigationTitle("Scan church invitation")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task {
                guard await scanner.isAvailable() else { message = "This device has no camera. You can still paste an invitation link."; return }
                let status = await scanner.currentAuthorization()
                let permission = status == .notDetermined ? await scanner.requestAccess() : status
                guard permission == .authorized else { message = "Camera access is off. Enable it in Settings or paste your invitation link."; return }
                do {
                    try await scanner.start { value in
                        guard let url = URL(string: value), let token = InvitationLink.token(from: url) else { return }
                        Task { @MainActor in
                            guard scanning else { return }
                            scanning = false
                            onToken(token); dismiss()
                        }
                    }
                    scanning = true
                } catch { message = "We couldn’t start the camera. You can still paste your invitation link." }
            }
            .onDisappear { Task { await scanner.stop() } }
        }
    }
}
#endif
