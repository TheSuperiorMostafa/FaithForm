package io.faithform.faithful.ui.giving

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import io.faithform.faithful.R
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.giving.AmountProblem
import io.faithform.faithful.giving.DonationPhase
import io.faithform.faithful.giving.GivingEmptyReason
import io.faithform.faithful.giving.GivingFailure
import io.faithform.faithful.giving.GivingListPhase
import io.faithform.faithful.giving.GivingScreenState
import io.faithform.faithful.giving.HistoryLabel
import io.faithform.faithful.giving.formatGivingAmount
import io.faithform.faithful.giving.historyLabel

/**
 * The Give experience.
 *
 * Behavioural parity with the SwiftUI screens — same states, same hierarchy,
 * same rule that a payment sheet is never presented by a screen appearing — with
 * Android's own controls. Every decision about which affordance appears lives in
 * [GivingScreenState], in `:core:giving`, where it is tested.
 *
 * Nothing here calls Stripe. `onGive` reports an intent upward and the model
 * decides; a screen cannot start a payment on its own.
 */
@Composable
fun GivingScreen(
    state: GivingScreenState,
    onSelectFund: (String) -> Unit,
    onAmountChange: (String) -> Unit,
    onContinue: () -> Unit,
    onRetry: () -> Unit,
    onHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (val phase = state.phase) {
        GivingListPhase.Idle, GivingListPhase.Loading ->
            Centered(modifier) { CircularProgressIndicator() }

        // The same answer a blocked visitor gets everywhere. Nothing about
        // giving, because there is nothing about this church to say.
        GivingListPhase.Blocked ->
            EmptyState(
                title = stringResource(R.string.giving_blocked_title),
                body = stringResource(R.string.giving_empty_body),
                modifier = modifier,
            )

        GivingListPhase.Offline ->
            EmptyState(
                title = stringResource(R.string.giving_offline_title),
                body = stringResource(R.string.giving_offline_body),
                onRetry = onRetry,
                modifier = modifier,
            )

        is GivingListPhase.Failed ->
            EmptyState(
                title = stringResource(R.string.giving_failed_title),
                body = phase.message,
                onRetry = onRetry,
                modifier = modifier,
            )

        is GivingListPhase.Loaded -> Loaded(
            state = state,
            onSelectFund = onSelectFund,
            onAmountChange = onAmountChange,
            onContinue = onContinue,
            onHistory = onHistory,
            modifier = modifier,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Loaded(
    state: GivingScreenState,
    onSelectFund: (String) -> Unit,
    onAmountChange: (String) -> Unit,
    onContinue: () -> Unit,
    onHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Three genuinely different empties, said differently. A church with no funds
    // has not opened any; a church that cannot charge has not finished setting
    // up. Telling a person "nothing here" for both would make one of them look
    // like a mistake they made.
    when (state.emptyReason) {
        GivingEmptyReason.NOT_ACCEPTING -> {
            EmptyState(
                title = stringResource(R.string.giving_not_accepting_title),
                body = stringResource(R.string.giving_not_accepting_body),
                modifier = modifier,
            )
            return
        }
        GivingEmptyReason.NOTHING_PUBLISHED -> {
            EmptyState(
                title = stringResource(R.string.giving_empty_title),
                body = stringResource(R.string.giving_empty_body),
                modifier = modifier,
            )
            return
        }
        null -> Unit
    }

    LazyColumn(
        modifier = modifier.fillMaxWidth().padding(FaithfulTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)) {
                state.churchName?.let {
                    Text(it, style = MaterialTheme.typography.headlineSmall)
                }
                Text(
                    stringResource(R.string.giving_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        items(state.funds, key = { it.fundId }) { fund ->
            val selected = fund.fundId == state.selectedFund?.fundId
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    // A selection is a *semantic* state, not a colour. A ring
                    // nobody can see is not a selection.
                    .selectable(selected = selected, onClick = { onSelectFund(fund.fundId) }),
            ) {
                Column(
                    modifier = Modifier.padding(FaithfulTokens.Spacing.md),
                    verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                ) {
                    Text(fund.title, style = MaterialTheme.typography.titleMedium)
                    fund.description?.takeIf { it.isNotBlank() }?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        item {
            val fund = state.selectedFund
            if (fund != null) {
                Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)) {
                    Text(
                        stringResource(R.string.giving_amount_label),
                        style = MaterialTheme.typography.titleMedium,
                    )

                    if (fund.suggestedAmounts.isNotEmpty()) {
                        // Wraps rather than scrolls: a chip a person cannot reach
                        // is a chip that is not there, and at large font scales a
                        // row of them will not fit.
                        FlowRow(
                            horizontalArrangement =
                                Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                        ) {
                            fund.suggestedAmounts.forEach { cents ->
                                OutlinedButton(onClick = {
                                    onAmountChange(
                                        if (cents % 100 == 0) "${cents / 100}"
                                        else formatGivingAmount(cents, fund.currency)
                                            .removePrefix("$"),
                                    )
                                }) {
                                    Text(formatGivingAmount(cents, fund.currency))
                                }
                            }
                        }
                    }

                    OutlinedTextField(
                        value = state.amountText,
                        onValueChange = onAmountChange,
                        label = { Text(stringResource(R.string.giving_custom_amount)) },
                        singleLine = true,
                        isError = state.amountProblem != null,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    state.amountProblem?.let { problem ->
                        Text(
                            text = stringResource(amountMessage(problem)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            // Announced when it appears, rather than found by
                            // someone wondering why the button does nothing.
                            modifier = Modifier.semantics {
                                liveRegion = LiveRegionMode.Polite
                            },
                        )
                    }

                    Button(
                        onClick = onContinue,
                        enabled = state.canContinue,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(stringResource(R.string.giving_continue)) }
                }
            }
        }

        if (state.showsRecurringNote) {
            item {
                Text(
                    stringResource(R.string.giving_recurring_elsewhere),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        item {
            OutlinedButton(onClick = onHistory, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.giving_history_title))
            }
        }
    }
}

private fun amountMessage(problem: AmountProblem): Int = when (problem) {
    AmountProblem.EMPTY, AmountProblem.NOT_A_NUMBER -> R.string.giving_amount_invalid
    AmountProblem.BELOW_MINIMUM -> R.string.giving_amount_too_low
    AmountProblem.ABOVE_MAXIMUM -> R.string.giving_amount_too_high
}

/**
 * The last screen before a payment sheet.
 *
 * Names the church, the fund and the amount, because a person about to pay
 * should be able to check all three without remembering what they tapped.
 */
@Composable
fun GivingConfirmScreen(
    churchName: String,
    fundTitle: String,
    amountCents: Int,
    currency: String,
    onGive: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(FaithfulTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg),
    ) {
        Text(
            stringResource(R.string.giving_confirm_title),
            style = MaterialTheme.typography.headlineSmall,
        )
        Card {
            Column(
                modifier = Modifier.padding(FaithfulTokens.Spacing.md),
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
            ) {
                ConfirmRow(stringResource(R.string.giving_confirm_church), churchName)
                ConfirmRow(stringResource(R.string.giving_confirm_fund), fundTitle)
                ConfirmRow(
                    stringResource(R.string.giving_confirm_amount),
                    formatGivingAmount(amountCents, currency),
                )
            }
        }
        Button(onClick = onGive, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.giving_give_now))
        }
    }
}

@Composable
private fun ConfirmRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * What happened, as far as the **server** knows.
 *
 * The processing state is not a success and does not read like one. A person
 * waiting here is told to wait; a person whose gift is confirmed is thanked.
 */
@Composable
fun GivingOutcomeScreen(
    state: GivingScreenState,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (val donation = state.donation) {
        DonationPhase.Idle, DonationPhase.Preparing, is DonationPhase.Presenting ->
            Centered(modifier) { CircularProgressIndicator() }

        is DonationPhase.AwaitingConfirmation ->
            Centered(modifier) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
                    // Announced as it changes, so someone using TalkBack is not
                    // left guessing whether anything is happening.
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                ) {
                    CircularProgressIndicator()
                    Text(
                        stringResource(R.string.giving_processing_title),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        stringResource(
                            if (state.pollingExhausted) R.string.giving_still_processing_body
                            else R.string.giving_processing_body,
                        ),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

        is DonationPhase.Confirmed ->
            Column(
                modifier = modifier.fillMaxWidth().padding(FaithfulTokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    stringResource(R.string.giving_succeeded_title),
                    style = MaterialTheme.typography.headlineSmall,
                )
                // The receipt is the server's, and only exists once the webhook
                // confirmed. When it has not arrived the thank-you stands alone
                // rather than showing a receipt this app invented.
                state.receipt?.let { receipt ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(FaithfulTokens.Spacing.md),
                            verticalArrangement =
                                Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                        ) {
                            Text(
                                stringResource(R.string.giving_receipt_title),
                                style = MaterialTheme.typography.labelSmall,
                            )
                            Text(
                                formatGivingAmount(receipt.amountCents, receipt.currency),
                                style = MaterialTheme.typography.headlineSmall,
                            )
                            Text(receipt.fundTitle, style = MaterialTheme.typography.bodyMedium)
                            Text(receipt.churchName, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.giving_continue))
                }
            }

        is DonationPhase.Cancelled ->
            EmptyState(
                title = stringResource(R.string.giving_cancelled_title),
                body = stringResource(R.string.giving_subtitle),
                onRetry = onDone,
                modifier = modifier,
            )

        is DonationPhase.Failed ->
            EmptyState(
                title = stringResource(R.string.giving_failed_title),
                body = stringResource(failureMessage(donation.reason)),
                onRetry = onDone,
                modifier = modifier,
            )
    }
}

private fun failureMessage(reason: GivingFailure): Int = when (reason) {
    GivingFailure.PAYMENT_DECLINED -> R.string.giving_failed_declined
    GivingFailure.NETWORK -> R.string.giving_failed_network
    GivingFailure.CHURCH_NOT_ACCEPTING -> R.string.giving_failed_not_accepting
    GivingFailure.NOT_ALLOWED -> R.string.giving_failed_not_allowed
    GivingFailure.UNAVAILABLE -> R.string.giving_unavailable_body
}

/** This account's own giving at this church. */
@Composable
fun GivingHistoryScreen(state: GivingScreenState, modifier: Modifier = Modifier) {
    if (state.historyLoading && state.history.isEmpty()) {
        Centered(modifier) { CircularProgressIndicator() }
        return
    }
    if (state.history.isEmpty()) {
        EmptyState(
            title = stringResource(R.string.giving_history_title),
            body = stringResource(R.string.giving_history_empty),
            modifier = modifier,
        )
        return
    }

    LazyColumn(
        modifier = modifier.fillMaxWidth().padding(FaithfulTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
    ) {
        item {
            // Said out loud, because a person looking at a giving list should
            // know whose it is.
            Text(
                stringResource(R.string.giving_history_only_yours),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        items(state.history, key = { it.attemptId }) { item ->
            Card(modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(FaithfulTokens.Spacing.md),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(
                        verticalArrangement =
                            Arrangement.spacedBy(FaithfulTokens.Spacing.xs),
                    ) {
                        Text(
                            formatGivingAmount(item.amountCents, item.currency),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(item.fundTitle, style = MaterialTheme.typography.bodySmall)
                    }
                    Text(
                        stringResource(statusLabel(historyLabel(item.status))),
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

private fun statusLabel(label: HistoryLabel): Int = when (label) {
    HistoryLabel.PROCESSING -> R.string.giving_status_processing
    HistoryLabel.SUCCEEDED -> R.string.giving_status_succeeded
    HistoryLabel.FAILED -> R.string.giving_status_failed
    HistoryLabel.CANCELLED -> R.string.giving_status_cancelled
    HistoryLabel.REFUNDED -> R.string.giving_status_refunded
    HistoryLabel.DISPUTED -> R.string.giving_status_disputed
}

@Composable
private fun Centered(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier.fillMaxWidth().padding(FaithfulTokens.Spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

@Composable
private fun EmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(FaithfulTokens.Spacing.xl)
            .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(body, style = MaterialTheme.typography.bodySmall)
        if (onRetry != null) {
            OutlinedButton(onClick = onRetry) {
                Text(stringResource(R.string.giving_retry))
            }
        }
    }
}
