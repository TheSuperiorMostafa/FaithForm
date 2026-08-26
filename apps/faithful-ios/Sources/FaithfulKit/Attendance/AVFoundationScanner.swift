#if canImport(AVFoundation)
import AVFoundation
import Foundation

/// The only file in Faithful that touches the camera.
///
/// **It contains no decisions.** When to ask, what a code means, whether a
/// person was counted — all of that is in `CheckInScanCoordinator` and
/// `QrScanning.swift`, which are plain Swift and testable anywhere. This file
/// translates, and nothing more.
///
/// ## What is deliberately absent
///
/// `AVCapturePhotoOutput`, `AVCaptureMovieFileOutput`,
/// `AVCaptureVideoDataOutput`, `PHPhotoLibrary`, and every API that could yield
/// an image or write one to disk. Faithful reads a string off a screen at the
/// front of a room; it has no reason to hold a frame and no way to keep one.
///
/// `AVCaptureMetadataOutput` is the whole capture surface: the OS decodes, and
/// what reaches this process is a string. There is no buffer here to leak.
///
/// ## Why the session lives in a box
///
/// `AVCaptureSession` is not `Sendable` and never will be: it is a
/// thread-confined object with blocking methods. Holding one as actor state
/// means every use is a value crossing an isolation boundary, which Swift 6
/// rejects — correctly, because `startRunning()` blocking an actor's executor is
/// a real bug and not a paperwork problem.
///
/// The compiler offers `@preconcurrency import AVFoundation`, which turns those
/// errors into warnings. That is deliberately **not** what this file does: it
/// would silence the diagnostic and keep the bug.
///
/// Instead the session and its output live in `CaptureBox`, which owns them,
/// serialises every touch on one private queue, and is `@unchecked Sendable`
/// because that queue is the invariant. The actor above holds a reference and
/// makes decisions; the box does the blocking work off the actor entirely.
///
/// ## What is not exercised in CI
///
/// The capture session below cannot run on a test runner: `swift test` executes
/// on macOS, there is no iOS camera, and no simulator vends real frames. So
/// `AVFoundationScanner`'s session wiring is **not covered by an automated
/// test** and is verified by the device runbook instead. What *is* covered —
/// because it was deliberately pulled out into `QrScanning.swift` — is the
/// authorization sequence, the payload filter, the debounce, the single-flight
/// guard and every outcome mapping. Saying otherwise would be the kind of claim
/// this project does not make.
public actor AVFoundationScanner: QrScanningFacade {

    #if os(iOS)
    /// Sendable by construction — see the note above. Safe to read from any
    /// isolation, because nothing out here mutates the session directly.
    private let capture = CaptureBox()
    #endif

    public init() {}

    public func isAvailable() -> Bool {
        #if os(iOS)
        return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
        #else
        // A Mac may well have a camera, but Faithful is an iOS app and this
        // path exists only so the package builds and its logic stays testable
        // on a development machine. Claiming availability here would make a
        // test look like a device.
        return false
        #endif
    }

    public func currentAuthorization() -> CameraAuthorization {
        #if os(iOS)
        return Self.normalise(AVCaptureDevice.authorizationStatus(for: .video))
        #else
        return .restricted
        #endif
    }

    public func requestAccess() async -> CameraAuthorization {
        #if os(iOS)
        // Only ever reached from `CheckInScanCoordinator.beginScanning()`,
        // which is only reachable from an explicit "Scan" action.
        _ = await AVCaptureDevice.requestAccess(for: .video)
        return currentAuthorization()
        #else
        return .restricted
        #endif
    }

    public func start(onCode: @Sendable @escaping (String) -> Void) async throws {
        #if os(iOS)
        guard currentAuthorization() == .authorized else {
            throw ScannerError.notAuthorized
        }
        try await capture.configureIfNeeded(onCode: onCode)
        // `startRunning` blocks. It runs on the box's own queue, so it blocks
        // that queue and nothing else — not this actor, and not the main thread.
        await capture.start()
        #else
        throw ScannerError.unavailable
        #endif
    }

    public func stop() async {
        #if os(iOS)
        await capture.stop()
        #endif
    }

    public enum ScannerError: Error, Sendable {
        case notAuthorized
        case unavailable
    }

    #if os(iOS)
    /// The session this scanner runs, for the SwiftUI preview layer.
    ///
    /// Exposed because a preview needs the session object and nothing else —
    /// not the output, not the device, and not any way to add another output.
    /// `nonisolated` because a preview layer is built on the main actor and
    /// cannot await. Handing out the reference is the one thing safe to do off
    /// the queue: `AVCaptureVideoPreviewLayer` holding a session while that
    /// session is started elsewhere is the arrangement AVFoundation is built
    /// around. **Every mutation still goes through the box.**
    public nonisolated var previewSession: AVCaptureSession { capture.session }

    /// Owns the capture session, and is the only thing that touches it.
    ///
    /// `@unchecked Sendable` is a claim, and this is the claim: every member
    /// below is either immutable or reached only from `queue`. The session
    /// reference escapes exactly once, to the preview layer, read-only.
    private final class CaptureBox: @unchecked Sendable {
        let session = AVCaptureSession()

        private let output = AVCaptureMetadataOutput()
        private let queue = DispatchQueue(label: "io.faithform.faithful.scanner")
        private var delegate: MetadataDelegate?
        private var configured = false

        func configureIfNeeded(onCode: @Sendable @escaping (String) -> Void) async throws {
            try await withCheckedThrowingContinuation { continuation in
                queue.async {
                    do {
                        try self.configureOnQueue(onCode: onCode)
                        continuation.resume()
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        }

        /// Only ever called on `queue`. That is what makes the class's
        /// `Sendable` claim true rather than hopeful.
        private func configureOnQueue(onCode: @Sendable @escaping (String) -> Void) throws {
            let handler = MetadataDelegate(onCode: onCode)
            delegate = handler

            guard !configured else {
                output.setMetadataObjectsDelegate(handler, queue: .main)
                return
            }

            session.beginConfiguration()
            defer { session.commitConfiguration() }

            guard
                let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                let input = try? AVCaptureDeviceInput(device: device),
                session.canAddInput(input),
                session.canAddOutput(output)
            else {
                throw ScannerError.unavailable
            }

            session.addInput(input)
            session.addOutput(output)
            output.setMetadataObjectsDelegate(handler, queue: .main)
            // **QR only.** Every other symbology is off, so a barcode on a hymn
            // book or a person's loyalty card never reaches this process at all.
            output.metadataObjectTypes = [.qr]

            configured = true
        }

        /// Idempotent, as the facade promises — and idempotent *correctly*: the
        /// running check happens on the same queue as the start, so two callers
        /// cannot both observe "not running" and both start it.
        func start() async {
            await withCheckedContinuation { continuation in
                queue.async {
                    if !self.session.isRunning { self.session.startRunning() }
                    continuation.resume()
                }
            }
        }

        func stop() async {
            await withCheckedContinuation { continuation in
                queue.async {
                    if self.session.isRunning { self.session.stopRunning() }
                    continuation.resume()
                }
            }
        }
    }

    static func normalise(_ status: AVAuthorizationStatus) -> CameraAuthorization {
        // Semantic cases, never raw values. Prompt 7 established this for
        // Core Location after an earlier version switched on numbers so that
        // macOS tests could construct a status — putting an undocumented
        // numeric contract on a permission path to make a test convenient.
        switch status {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .restricted: return .restricted
        case .authorized: return .authorized
        @unknown default: return .restricted
        }
    }

    /// Forwards decoded strings. **Holds no frame and no image.**
    private final class MetadataDelegate: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
        private let onCode: @Sendable (String) -> Void

        init(onCode: @escaping @Sendable (String) -> Void) {
            self.onCode = onCode
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            for object in metadataObjects {
                guard
                    let machineReadable = object as? AVMetadataMachineReadableCodeObject,
                    machineReadable.type == .qr,
                    let value = machineReadable.stringValue
                else { continue }
                // The string, and only the string. `machineReadable` also
                // carries corner coordinates and bounds; neither is read, and
                // neither leaves this loop.
                onCode(value)
            }
        }
    }
    #endif
}
#endif


