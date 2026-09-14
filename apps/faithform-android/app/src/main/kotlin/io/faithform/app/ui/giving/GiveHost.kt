package io.faithform.app.ui.giving

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.app.R
import io.faithform.app.giving.AmountResult
import io.faithform.app.giving.DonationPhase
import io.faithform.app.giving.GivingClient
import io.faithform.app.giving.GivingModel
import io.faithform.app.giving.PaymentSheetFacade
import io.faithform.app.giving.PendingDonationStore
import io.faithform.app.storage.CachePartition
import io.faithform.app.ui.host.TabScreen
import io.faithform.app.ui.host.rememberSessionModel

/** Where the Give tab is, below its form. */
private enum class GiveRoute { FORM, CONFIRM, HISTORY }

/**
 * The Give tab: choose a fund and an amount, check it over, give in Stripe's
 * own sheet, and hear what the server says happened.
 *
 * Google Play does not require Play Billing for donations to a tax-exempt
 * organisation, which every FaithForm church is, so the gift is taken in the
 * app with Stripe for any church whose giving is available. Google Pay stays
 * off in v1 (see `GivingModel`).
 *
 * The model is a session model: a rotation, or Stripe's sheet covering this
 * screen, does not lose a gift in flight. While a gift is anywhere between
 * "Give" and a final answer, the outcome screen is what shows — it is derived
 * from the model's state, not from where the person last navigated.
 */
@Composable
fun GiveTab(
    client: GivingClient,
    sheet: PaymentSheetFacade,
    pendingDonations: PendingDonationStore,
    churchSlug: String,
    partition: CachePartition,
    modifier: Modifier = Modifier,
) {
    var route by rememberSaveable(partition.storageKey) { mutableStateOf(GiveRoute.FORM) }

    val holder = rememberSessionModel("giving|${partition.storageKey}") {
        GivingModel(client, sheet, pendingDonations, churchSlug, partition)
    }
    LaunchedEffect(holder) {
        holder.launchOnce("load") {
            load()
            // A gift interrupted by a process kill is asked about, never restarted.
            resumeInterruptedDonation()
        }
    }

    val state by holder.value.state.collectAsStateWithLifecycle()
    val title = stringResource(R.string.giving_title)

    if (state.donation !is DonationPhase.Idle) {
        TabScreen(title = title, modifier = modifier) { content ->
            GivingOutcomeScreen(
                state = state,
                onDone = {
                    holder.value.finishDonation()
                    route = GiveRoute.FORM
                },
                modifier = content,
            )
        }
        return
    }

    when (route) {
        GiveRoute.FORM -> TabScreen(title = title, modifier = modifier) { content ->
            GivingScreen(
                state = state,
                onSelectFund = holder.value::selectFund,
                onAmountChange = holder.value::updateAmount,
                onContinue = { if (state.canContinue) route = GiveRoute.CONFIRM },
                onRetry = { holder.launch { load() } },
                onHistory = {
                    route = GiveRoute.HISTORY
                    holder.launch { loadHistory() }
                },
                modifier = content,
            )
        }

        GiveRoute.CONFIRM -> {
            val fund = state.selectedFund
            val cents = (state.amountResult as? AmountResult.Valid)?.cents
            if (fund == null || cents == null) {
                // The fund list changed underneath the confirm screen (a
                // refresh withdrew the fund). Back to the form, never a
                // confirmation of something that is no longer offered.
                LaunchedEffect(Unit) { route = GiveRoute.FORM }
                return
            }
            TabScreen(
                title = title,
                onBack = { route = GiveRoute.FORM },
                modifier = modifier,
            ) { content ->
                GivingConfirmScreen(
                    churchName = state.churchName.orEmpty(),
                    fundTitle = fund.title,
                    amountCents = cents,
                    currency = fund.currency,
                    onGive = { holder.launch { give() } },
                    modifier = content,
                )
            }
        }

        GiveRoute.HISTORY -> TabScreen(
            title = stringResource(R.string.giving_history_title),
            onBack = { route = GiveRoute.FORM },
            modifier = modifier,
        ) { content ->
            GivingHistoryScreen(state = state, modifier = content)
        }
    }
}
