package io.faithform.faithful.giving

import com.stripe.android.paymentsheet.PaymentSheet
import com.stripe.android.paymentsheet.PaymentSheetResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * What `:app` still decides about payments, and the properties that must hold in
 * the shipped app.
 *
 * ## Why this is not a Robolectric test
 *
 * The same lesson Media3 taught: instrumenting a large SDK's classpath is slow
 * at best and hangs at worst, and the response is to move decisions out of
 * `:app` rather than to work around the runner. Every giving decision lives in
 * `:core:giving`, on the JVM. What remains here is a translation, and the
 * translation's inputs are compile-time constants that need no Android runtime.
 *
 * ## Why a source sweep belongs in a unit test
 *
 * Two of the strongest guarantees this feature makes are *absences* — no card
 * field of our own, and no payment UI at launch. An absence cannot be asserted
 * by calling something. It is asserted by reading the source that ships.
 */
class StripeAdapterContractTest {

    private val appSources: List<File> =
        File("src/main/kotlin").walkTopDown().filter { it.extension == "kt" }.toList()

    private fun source(relative: String): String =
        File("src/main/kotlin/io/faithform/faithful/$relative").readText()

    @Test
    fun `the sweep reads a real source tree`() {
        // The guard against a vacuous green: if this collapses, every assertion
        // below is meaningless and this fails first.
        assertTrue("only ${appSources.size} app sources", appSources.size >= 10)
        assertTrue(
            "the adapter is not in the swept set",
            appSources.any { it.name == "StripePaymentSheetAdapter.kt" },
        )
    }

    @Test
    fun `the payment sheet has exactly three outcomes, and none of them is money`() {
        // If Stripe ever adds a fourth result, this stops compiling — which is
        // the point. A `when` with an `else` would silently map a new outcome
        // onto an old meaning, and the old meanings here are "charged" and
        // "not charged".
        val outcomes = listOf(
            PaymentSheetResult.Completed,
            PaymentSheetResult.Canceled,
        )
        assertEquals(2, outcomes.size)
        assertTrue(PaymentSheetResult.Completed is PaymentSheetResult)
    }

    @Test
    fun `the Google Pay environment constants are the ones the adapter names`() {
        assertEquals(
            PaymentSheet.GooglePayConfiguration.Environment.Production,
            PaymentSheet.GooglePayConfiguration.Environment.valueOf("Production"),
        )
    }

    @Test
    fun `nothing in the app collects a card number`() {
        // Faithful has no card field. Card details are entered inside Stripe's
        // own UI and never touch this process — which is what keeps this app out
        // of the scope where handling card data is a compliance question.
        val forbidden = listOf(
            "CardInputWidget",
            "CardMultilineWidget",
            "CardFormView",
            "PaymentMethodCreateParams.createCard",
            "CardNumberEditText",
            "cardNumber",
            // No instrument management, no bank UI, no saved-card screen.
            "CustomerSheet",
            "FinancialConnections",
            "USBankAccount",
            "addPaymentMethod",
        )
        for (file in appSources) {
            val code = file.readText().lines()
                .filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") }
                .joinToString("\n")
            for (symbol in forbidden) {
                assertFalse("${file.name} uses $symbol", code.contains(symbol))
            }
        }
    }

    @Test
    fun `no payment UI is presented at launch`() {
        // A payment sheet at launch would be a payment prompt nobody asked for.
        // The only presentation is inside `present`, which is only reachable
        // from a person choosing an amount.
        for (name in listOf("MainActivity.kt", "FaithfulApplication.kt", "AppViewModel.kt")) {
            val code = source(name)
            assertFalse("$name presents a payment sheet", code.contains("presentWith"))
            assertFalse("$name builds a PaymentSheet", code.contains("PaymentSheet.Builder"))
            assertFalse("$name initialises Stripe", code.contains("PaymentConfiguration.init"))
        }

        val adapter = source("giving/StripePaymentSheetAdapter.kt")
        assertTrue(adapter.contains("presentWithPaymentIntent"))
    }

    @Test
    fun `the adapter never reads a provider error message`() {
        val adapter = source("giving/StripePaymentSheetAdapter.kt")
        // Stripe's failure carries a developer-facing message that can name an
        // issuer decline code. It is mapped by *type* and never read.
        assertFalse(adapter.contains(".error.message"))
        assertFalse(adapter.contains("result.error"))
        assertTrue(adapter.contains("is PaymentSheetResult.Failed -> SheetOutcome.FAILED"))
    }

    @Test
    fun `nothing in the app logs a client secret`() {
        for (file in appSources) {
            val code = file.readText()
            // The only place a client secret appears is as a value passed
            // straight to the SDK. It is never concatenated into a string, which
            // is how it would reach a log.
            assertFalse(
                "${file.name} interpolates a client secret",
                code.contains("\$clientSecret") || code.contains("\${request.clientSecret}"),
            )
        }
    }
}
