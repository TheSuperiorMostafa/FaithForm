package io.faithform.app.giving

import androidx.activity.ComponentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.stripe.android.PaymentConfiguration
import com.stripe.android.paymentsheet.PaymentSheet
import com.stripe.android.paymentsheet.PaymentSheetResult
import io.faithform.app.host.ActivityResultRelay

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
 * FaithForm never collects a card number. `PaymentSheet` presents Stripe's own
 * UI, the card details go to Stripe directly, and this app never sees them —
 * which is what keeps it out of the scope where handling card data is a
 * compliance question rather than an engineering one.
 *
 * ## Why it answers through a relay
 *
 * `PaymentSheet` registers an activity-result launcher, which must happen
 * before its Activity starts — so one adapter is built per Activity, in
 * `onCreate`. The gift itself belongs to a view model that survives rotation.
 * If the adapter held the waiting coroutine, rotating the phone while Stripe's
 * sheet was open would deliver the result to the *new* Activity's sheet while
 * the gift waited forever on the old one. Instead the waiting half lives in the
 * app-scoped [ActivityResultRelay]: each adapter attaches itself as the current
 * presenter, and whichever instance receives Stripe's result delivers it there.
 *
 * ## What is deliberately absent
 *
 * No `PaymentSheet.FlowController` with a saved-card screen, no
 * `CustomerSheet`, no `addPaymentMethod`, and no bank-account UI. FaithForm gives
 * once; it does not manage instruments. Recurring giving lives in the church's
 * existing donor portal.
 */
class StripePaymentSheetAdapter(
    private val activity: ComponentActivity,
    private val relay: ActivityResultRelay<PaymentSheetRequest, SheetOutcome>,
) {

    /** Registered once, at construction — before the Activity reaches STARTED. */
    private val sheet = PaymentSheet.Builder { result ->
        relay.deliver(outcomeOf(result))
    }.build(activity)

    private val presenter: (PaymentSheetRequest) -> Unit = ::present

    init {
        relay.attach(presenter)
        activity.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) = relay.detach(presenter)
        })
    }

    private fun present(request: PaymentSheetRequest) {
        // The publishable key and the connected account both come from the
        // server, per church. A church's account id is an identifier rather
        // than a credential, and the SDK needs it to charge that account
        // directly rather than the platform's.
        PaymentConfiguration.init(
            activity.applicationContext,
            request.publishableKey,
            request.stripeAccountId,
        )

        sheet.presentWithPaymentIntent(
            request.clientSecret,
            PaymentSheet.Configuration.Builder(request.merchantName)
                .googlePay(
                    // Only when the server said so — and in v1 it never does:
                    // `GivingModel` presents every sheet with Google Pay off.
                    if (request.allowGooglePay) {
                        PaymentSheet.GooglePayConfiguration(
                            // Derived from the publishable key, not hardcoded:
                            // Google Pay's environment has to match the Stripe
                            // key, and a hardcoded `Production` refuses against a
                            // test key — in exactly the environment someone is
                            // testing in.
                            environment = when (walletEnvironment(request.publishableKey)) {
                                WalletEnvironment.PRODUCTION ->
                                    PaymentSheet.GooglePayConfiguration.Environment.Production
                                WalletEnvironment.TEST ->
                                    PaymentSheet.GooglePayConfiguration.Environment.Test
                            },
                            // The gift's own currency from the donation session,
                            // and the country only the server can know. This
                            // used to be "US" and "USD" whatever the church.
                            countryCode = request.countryCode,
                            currencyCode = request.currencyCode,
                        )
                    } else {
                        null
                    },
                )
                // No saved cards, and nothing kept between gifts: FaithForm
                // has no instrument-management surface to keep them for.
                .allowsDelayedPaymentMethods(false)
                .build(),
        )
    }

    companion object {
        /**
         * One SDK result, one enum. Nothing about money crosses this line.
         */
        fun outcomeOf(result: PaymentSheetResult): SheetOutcome = when (result) {
            // **Completed, not confirmed.** The sheet finishing means the
            // payment was submitted. `:core:giving` maps this to
            // AwaitingConfirmation and the server decides the rest.
            is PaymentSheetResult.Completed -> SheetOutcome.COMPLETED
            is PaymentSheetResult.Canceled -> SheetOutcome.CANCELLED
            // The error is **not** read. Stripe's message is written for a
            // developer and can name an issuer decline code; it is never shown,
            // and never logged.
            is PaymentSheetResult.Failed -> SheetOutcome.FAILED
        }
    }
}

/**
 * What the giving model holds: a payment sheet that is presented by whichever
 * Activity is current, and answers even if that Activity changed while it was
 * open. With no Activity attached it answers `FAILED` — nothing was charged —
 * rather than hanging.
 */
class RelayedPaymentSheet(
    private val relay: ActivityResultRelay<PaymentSheetRequest, SheetOutcome>,
) : PaymentSheetFacade {
    override suspend fun present(request: PaymentSheetRequest): SheetOutcome = relay.request(request)
}
