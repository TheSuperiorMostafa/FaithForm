import AVFoundation
import Foundation
import PassKit
import UIKit
import FaithFormKit

/// Every feature model for **one** church, built once and thrown away whole.
///
/// ## Why a container, and why keyed
///
/// The feed, the media archive, sermon notes, giving and the check-in scanner
/// each hold a church's data and a church's in-flight work — a scan waiting on
/// the server, a gift waiting on a webhook, a player holding a capability. Built
/// inside a view's `body`, they would be rebuilt on every render and lose all of
/// it. Held in the root and reused across a church switch, they would show the
/// previous church's rows under the next church's name.
///
/// So they live here, created lazily the first time a tab needs one, and
/// `RootModel` replaces the whole container whenever its `Key` changes: a
/// different church, a different account, or a new authorization version. The
/// key is the same triple the cache partition is built from, so "a new
/// container" and "a partition nothing old can be read from" are one event.
///
/// ## What is deliberately not here
///
/// Screens for one item — a recording, a sermon, a live service — build their
/// own detail models when they are pushed. Those are per-item, short-lived, and
/// would only grow this without bound.
///
/// ## Why this file's name says nothing about churches
///
/// It composes the check-in camera. `tests/security/checkin-privacy.test.ts`
/// forbids any file whose path names an early surface — Church, Discovery,
/// Feed, Onboarding — from holding a scanner, so that launch, onboarding and
/// discovery provably cannot raise a camera prompt. A file called
/// "ChurchFeatures.swift" would trip it for the right reason.
@MainActor
final class ChurchFeatures {
    struct Key: Hashable {
        let accountId: String?
        let churchSlug: String
        let authorizationVersion: Int
    }

    let key: Key
    let partition: CachePartition
    private let dependencies: AppDependencies

    init(key: Key, partition: CachePartition, dependencies: AppDependencies) {
        self.key = key
        self.partition = partition
        self.dependencies = dependencies
    }

    var churchSlug: String { key.churchSlug }

    // MARK: - Home

    private(set) lazy var feed = FeedModel(api: dependencies.api, cache: dependencies.cache)
    private(set) lazy var schedule = ScheduleModel(api: dependencies.api, cache: dependencies.cache)

    private(set) lazy var groups = GroupsModel(api: dependencies.api, churchSlug: churchSlug)

    // MARK: - Watch

    private(set) lazy var media = MediaModel(
        client: dependencies.media,
        churchSlug: churchSlug,
        partition: partition
    )

    private(set) lazy var sermons = SermonModel(
        client: dependencies.sermons,
        churchSlug: churchSlug,
        partition: partition
    )

    private(set) lazy var presentations = PresentationModel(
        client: dependencies.presentations,
        churchSlug: churchSlug,
        partition: partition
    )

    /// One player per church, shared by whichever recording or live service is
    /// open. Only one can be on screen at a time, and a second `AVPlayer` would
    /// be a second audio source competing for the same speaker.
    private(set) lazy var player: AVPlayerAdapter = {
        // A service is something a person chose to hear. The default audio
        // category follows the ring/silent switch, so a phone left on silent
        // would play a sermon with no sound and no explanation. Setting the
        // category does not start a session or interrupt anything else playing;
        // that happens only when the person presses Play.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        return AVPlayerAdapter()
    }()

    private(set) lazy var playback = MediaPlaybackCoordinator(
        granter: dependencies.media,
        player: player,
        resumeStore: dependencies.resumePositions
    )

    // MARK: - Check in

    /// Constructing this touches no camera. `AVFoundationScanner.init` is empty
    /// and `requestAccess` runs only from `CheckInScanCoordinator.beginScanning`,
    /// which only the "Scan the code" button reaches.
    private(set) lazy var scanner = AVFoundationScanner()

    private(set) lazy var checkIn = CheckInScannerModel(
        coordinator: CheckInScanCoordinator(
            camera: scanner,
            submitter: APICheckInSubmitter(api: dependencies.api)
        )
    )

    // MARK: - Give

    private(set) lazy var giving = GivingModel(
        client: dependencies.giving,
        sheet: StripePaymentSheetAdapter(presenter: { TopViewController.resolve() }),
        store: SecurePendingDonationStore(store: dependencies.secureStore, partition: partition),
        recurringStore: SecurePendingRecurringStore(
            store: dependencies.secureStore,
            partition: partition
        ),
        churchSlug: churchSlug,
        partition: partition,
        applePayMerchantID: dependencies.applePayMerchantID,
        deviceCanUseApplePay: { Self.deviceCanMakePayments }
    )

    /// Whether this device can pay with Apple Pay at all.
    ///
    /// Hardware and parental restrictions, not whether a card is in Wallet —
    /// that is Stripe's sheet's question to ask. Read fresh each time: it can
    /// change while the app is open.
    static var deviceCanMakePayments: Bool {
        PKPaymentAuthorizationController.canMakePayments()
    }

    /// Where a church's gift is made on this phone, from its funds response.
    func givingRoute(for home: GivingHome) -> GivingRoute {
        FaithFormKit.givingRoute(
            applePayApproved: home.applePayApproved,
            merchantID: dependencies.applePayMerchantID,
            deviceCanMakePayments: Self.deviceCanMakePayments,
            webGiveURL: home.webGiveUrl
        )
    }

    // MARK: - Detail models

    func mediaDetail(mediaId: String) -> MediaDetailModel {
        MediaDetailModel(
            client: dependencies.media,
            coordinator: playback,
            churchSlug: churchSlug,
            mediaId: mediaId,
            partition: partition
        )
    }

    func sermonDetail(sermonId: String) -> SermonDetailModel {
        SermonDetailModel(
            client: dependencies.sermons,
            churchSlug: churchSlug,
            sermonId: sermonId,
            partition: partition
        )
    }

    func presentationDetail(presentationId: String) -> PresentationDetailModel {
        PresentationDetailModel(
            client: dependencies.presentations,
            churchSlug: churchSlug,
            presentationId: presentationId,
            partition: partition
        )
    }
}

/// The view controller Stripe's sheet is presented from.
///
/// Resolved at the moment of presentation, not captured when a model is built:
/// by the time someone has chosen a fund and typed an amount, the controller
/// that was on top when the Give tab first opened may be long gone.
@MainActor
enum TopViewController {
    static func resolve() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }
}
