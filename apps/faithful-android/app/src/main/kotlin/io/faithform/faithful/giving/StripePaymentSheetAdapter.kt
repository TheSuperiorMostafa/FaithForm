package io.faithform.faithful.giving

import androidx.activity.ComponentActivity
import com.stripe.android.PaymentConfiguration
import com.stripe.android.paymentsheet.PaymentSheet
import com.stripe.android.paymentsheet.PaymentSheetResult
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * The Stripe payment sheet, and nothing else.
 *
 * ## Why this file holds no decisions
 *
 * Everything that depends on the result — what a person is told, whether a
 * receipt exists, what a retry does, whether the gift is confirmed — is in
 * `:core:giving`, on the JVM, where `gradlew :core:giving:test` reaches it. This
 * class translates one SDK result into one enum and stops. That is the same
 * arrangement `Media3PlayerAdapter` uses, for the same reason: a payment flow
 * that could only be tested by opening a payment sheet would not be tested.
 *
 * ## Why the card field is Stripe's
 *
 * Faithful never collects a card number. `PaymentSheet` presents Stripe's own
 * UI, the card details go to Stripe directly, and this app never sees them —
 * which is what keeps it out of the scope where handling card data is a
 * compliance question rather than an engineering one.
 *
 * ## What is deliberately absent
 *
 * No `PaymentSheet.FlowController` with a saved-card screen, no
 * `CustomerSheet`, no `addPaymentMethod`, and no bank-account UI. Faithful gives
 * once; it does not manage instruments. Recurring giving lives in the church's
 * existing donor portal.
 */
class StripePaymentSheetAdapter(
    private val activity: ComponentActivity,
) : PaymentSheetFacade {

    /**
     * Registered once, at construction.
     *
     * `PaymentSheet` registers an activity-result launcher, which Android
     * requires before the activity reaches STARTED. Building this lazily on
     * first use would crash on the first gift a person ever made — the least
     * forgiving moment to find out.
     */
    private var continuation: ((PaymentSheetResult) -> Unit)? = null

    private val sheet = PaymentSheet.Builder { result ->
        val pending = continuation
        continuation = null
        pending?.invoke(result)
    }.build(activity)

    override suspend fun present(request: PaymentSheetRequest): SheetOutcome =
        suspendCoroutine { cont ->
            // The publishable key and the connected account both come from the
            // server, per church. A church's account id is an identifier rather
            // than a credential, and the SDK needs it to charge that account
            // directly rather than the platform's.
            PaymentConfiguration.init(
                activity.applicationContext,
                request.publishableKey,
                request.stripeAccountId,
            )

            continuation = { result ->
                cont.resume(
                    when (result) {
                        // **Completed, not confirmed.** The sheet finishing means
                        // the payment was submitted. `:core:giving` maps this to
                        // AwaitingConfirmation and the server decides the rest.
                        is PaymentSheetResult.Completed -> SheetOutcome.COMPLETED
                        is PaymentSheetResult.Canceled -> SheetOutcome.CANCELLED
                        // The error is **not** read. Stripe's message is written
                        // for a developer and can name an issuer decline code;
                        // it is never shown, and never logged.
                        is PaymentSheetResult.Failed -> SheetOutcome.FAILED
                    },
                )
            }

            sheet.presentWithPaymentIntent(
                request.clientSecret,
                PaymentSheet.Configuration.Builder(request.merchantName)
                    .googlePay(
                        // Only when the server said so. A device that has Google
                        // Pay proves a wallet exists, not that this church's
                        // Stripe account accepts it.
                        if (request.allowGooglePay) {
                            PaymentSheet.GooglePayConfiguration(
                                // Derived from the publishable key, not
                                // hardcoded: Google Pay's environment has to
                                // match the Stripe key, and a hardcoded
                                // `Production` refuses against a test key — in
                                // exactly the environment someone is testing in.
                                environment = when (walletEnvironment(request.publishableKey)) {
                                    WalletEnvironment.PRODUCTION ->
                                        PaymentSheet.GooglePayConfiguration.Environment.Production
                                    WalletEnvironment.TEST ->
                                        PaymentSheet.GooglePayConfiguration.Environment.Test
                                },
                                countryCode = "US",
                                currencyCode = "USD",
                            )
                        } else {
                            null
                        },
                    )
                    // No saved cards, and nothing kept between gifts: Faithful
                    // has no instrument-management surface to keep them for.
                    .allowsDelayedPaymentMethods(false)
                    .build(),
            )
        }
}
