package io.faithform.faithful.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import io.faithform.faithful.R
import io.faithform.faithful.design.FaithfulTokens

/**
 * What a build with no origin shows.
 *
 * A developer sees exactly which value is missing. A person sees a sentence that
 * does not blame them and does not pretend the app is loading. This is the
 * visible half of failing closed — the other half is that no object graph was
 * built and no network call was attempted.
 *
 * Mirrors `UnconfiguredView` on iOS.
 */
@Composable
fun UnconfiguredScreen(reason: String?, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(FaithfulTokens.Spacing.xl)
            .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm, Alignment.CenterVertically),
    ) {
        Text(
            stringResource(R.string.not_configured_title),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.not_configured_body),
            style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.Center,
        )
        if (!reason.isNullOrBlank()) {
            Text(
                reason,
                style = MaterialTheme.typography.labelSmall,
                textAlign = TextAlign.Center,
            )
        }
    }
}
