#if canImport(StripePaymentSheet) && os(iOS)
import Foundation
import StripePaymentSheet
import UIKit

/// The Stripe payment sheet, and nothing else.
///
/// ## Why this file holds no decisions
///
/// Everything that depends on the result — what a person is told, whether a
/// receipt exists, what a retry does, whether the gift is confirmed — is in
/// `Giving.swift`, which is platform-free and runs under `swift test`. This
/// actor translates one SDK result into one enum and stops. Same arrangement as
/// `AVPlayerAdapter`, for the same reason: a payment flow that could only be
/// tested by opening a payment sheet would not be tested.
///
/// ## Why the card field is Stripe's
///
/// Faithful never collects a card number. `PaymentSheet` presents Stripe's own
/// UI, the card details go to Stripe directly, and this app never sees them —
/// which is what keeps it out of the scope where handling card data is a
/// compliance question rather than an engineering one.
///
/// ## What is deliberately absent
///
/// No `PaymentSheet.FlowController` with a saved-card screen, no
/// `CustomerSheet`, no `STPPaymentMethodCardParams`, and no bank-account UI.
/// Faithful gives once; it does not manage instruments. Recurring giving lives
/// in the church's existing donor portal.
///
/// ## What is not verified here
///
/// **This has never been run.** There is no iOS app target in this repository —
/// `apps/faithful-ios` is a library — so nothing presents this sheet, and no
/// device has seen it. It compiles for iOS, which is what the device-build gate
/// checks, and that is the whole of the claim.
public actor StripePaymentSheetAdapter: PaymentSheetFacade {

    private let presenter: @MainActor () -> UIViewController?

    /// - Parameter presenter: resolves the view controller to present from, at
    ///   the moment of presentation rather than at construction. A controller
    ///   captured early is a controller that may have been dismissed by the time
    ///   a person finishes typing an amount.
    public init(presenter: @escaping @MainActor () -> UIViewController?) {
        self.presenter = presenter
    }

    public func present(_ request: PaymentSheetRequest) async -> SheetOutcome {
        // **Everything Stripe touches happens on the main actor.**
        //
        // `PaymentSheet` and `PaymentSheet.Configuration` are UIKit-era types
        // and are not `Sendable`. Building one here and handing it to the main
        // actor is a value crossing an isolation boundary, which Swift 6 rejects
        // — correctly, because presenting UIKit from an actor's executor is a
        // real bug rather than paperwork. So the actor decides *whether* to
        // present and the main actor does all of it.
        await MainActor.run { [presenter] in
            STPAPIClient.shared.publishableKey = request.publishableKey
            STPAPIClient.shared.stripeAccount = request.stripeAccountID
            _ = presenter
        }

        return await withCheckedContinuation { continuation in
            Task { @MainActor [presenter] in
                guard let controller = presenter() else {
                    continuation.resume(returning: SheetOutcome.failed)
                    return
                }

                var configuration = PaymentSheet.Configuration()
                configuration.merchantDisplayName = request.merchantName
                // No saved cards, and nothing kept between gifts: Faithful has
                // no instrument-management surface to keep them for.
                configuration.allowsDelayedPaymentMethods = false

                if request.allowApplePay,
                   let merchantID = request.appleMerchantID,
                   !merchantID.isEmpty {
                    // Only when the server said so *and* this build carries the
                    // entitlement. A device that can make payments proves a
                    // wallet exists, not that this church's Stripe account
                    // accepts it.
                    configuration.applePay = .init(
                        merchantId: merchantID,
                        merchantCountryCode: "US"
                    )
                }

                let sheet = PaymentSheet(
                    paymentIntentClientSecret: request.clientSecret,
                    configuration: configuration
                )

                sheet.present(from: controller) { result in
                    let outcome: SheetOutcome
                    switch result {
                    // **Completed, not confirmed.** The sheet finishing means
                    // the payment was submitted. `Giving.swift` maps this to
                    // `awaitingConfirmation` and the server decides the rest.
                    case .completed: outcome = .completed
                    case .canceled: outcome = .cancelled
                    // The error is **not** read. Stripe's message is written for
                    // a developer and can name an issuer decline code; it is
                    // never shown, and never logged.
                    case .failed: outcome = .failed
                    }
                    continuation.resume(returning: outcome)
                }
            }
        }
    }
}
#endif
