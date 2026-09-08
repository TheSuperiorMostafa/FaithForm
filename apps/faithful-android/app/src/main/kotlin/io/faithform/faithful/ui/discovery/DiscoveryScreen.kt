package io.faithform.faithful.ui.discovery

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import io.faithform.faithful.R
import io.faithform.faithful.contract.DiscoveredChurch
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.design.LocalFaithfulTheme
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff

/**
 * The welcome screen someone sees with no church yet.
 *
 * Two doors and nothing else — the same information hierarchy as the SwiftUI
 * WelcomeView, rendered with Android-native components.
 */
@Composable
fun WelcomeScreen(onFindChurch: () -> Unit, onHaveInvitation: () -> Unit) {
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg)
    ) {
        Spacer(Modifier.heightIn(min = FaithfulTokens.Spacing.xxl))
        Text(
            stringResource(R.string.welcome_title),
            style = MaterialTheme.typography.displayLarge,
            color = theme.palette.contentPrimary
        )
        Text(
            stringResource(R.string.welcome_body),
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentSecondary
        )
        Spacer(Modifier.weight(1f))
        Button(
            onClick = onFindChurch,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) {
            Icon(
                Icons.Outlined.Search,
                contentDescription = null,
                modifier = Modifier.size(FaithfulTokens.IconSize.sizeMedium)
            )
            Spacer(Modifier.size(FaithfulTokens.Spacing.sm))
            Text(stringResource(R.string.find_a_church))
        }
        OutlinedButton(
            onClick = onHaveInvitation,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) {
            Icon(
                Icons.Outlined.MarkEmailUnread,
                contentDescription = null,
                modifier = Modifier.size(FaithfulTokens.IconSize.sizeMedium)
            )
            Spacer(Modifier.size(FaithfulTokens.Spacing.sm))
            Text(stringResource(R.string.have_invitation))
        }
    }
}

/** Why location is being asked for, before the runtime dialog is raised. */
@Composable
fun LocationEducationScreen(onContinue: () -> Unit, onSkip: () -> Unit) {
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg)
    ) {
        Text(
            stringResource(R.string.location_education_title),
            style = MaterialTheme.typography.displayMedium,
            color = theme.palette.contentPrimary
        )
        Text(
            stringResource(R.string.location_education_body),
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentSecondary
        )
        Spacer(Modifier.weight(1f))
        Button(
            onClick = onContinue,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) { Text(stringResource(R.string.location_continue)) }
        OutlinedButton(
            onClick = onSkip,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) { Text(stringResource(R.string.location_skip)) }
    }
}

@Composable
fun DiscoveryScreen(
    phase: DiscoveryPhase,
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onNearby: () -> Unit,
    onOpenChurch: (String) -> Unit
) {
    val theme = LocalFaithfulTheme.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(horizontal = FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.base)
    ) {
        val searchHint = stringResource(R.string.search_placeholder)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(theme.palette.surfaceSunken, RoundedCornerShape(FaithfulTokens.Radius.pill))
                .heightIn(min = FaithfulTokens.TouchTarget.minimum)
                .padding(horizontal = FaithfulTokens.Spacing.base)
                .semantics { contentDescription = searchHint },
            verticalAlignment = Alignment.CenterVertically
        ) {
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = TextStyle(color = theme.palette.contentPrimary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                modifier = Modifier.fillMaxWidth()
            )
        }

        OutlinedButton(
            onClick = onNearby,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) { Text(stringResource(R.string.churches_near_me)) }

        when (phase) {
            is DiscoveryPhase.Idle -> EmptyState(
                stringResource(R.string.search_results_title),
                stringResource(R.string.search_placeholder),
                icon = Icons.Outlined.Search,
            )
            is DiscoveryPhase.Searching -> Column(
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)
            ) { repeat(3) { SkeletonCard() } }

            is DiscoveryPhase.Results -> LazyColumn(
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)
            ) {
                items(phase.churches, key = { it.slug }) { church ->
                    ChurchResultCard(church) { onOpenChurch(church.slug) }
                }
            }

            is DiscoveryPhase.Empty -> EmptyState(
                stringResource(R.string.no_results_title),
                stringResource(R.string.no_results_body),
                icon = Icons.Outlined.SearchOff,
            )
            is DiscoveryPhase.Offline -> EmptyState(
                stringResource(R.string.offline_title),
                stringResource(R.string.offline_body),
                icon = Icons.Outlined.WifiOff,
            )
            is DiscoveryPhase.Failed -> EmptyState(
                stringResource(R.string.error_title),
                phase.message,
                icon = Icons.Outlined.WarningAmber,
            )
        }
    }
}

@Composable
private fun ChurchResultCard(church: DiscoveredChurch, onOpen: () -> Unit) {
    val theme = LocalFaithfulTheme.current
    val place = listOfNotNull(church.city, church.state).filter { it.isNotBlank() }.joinToString(", ")
    val distance = church.distanceKm?.let {
        stringResource(R.string.distance_away, String.format("%.1f", it))
    }
    // One merged element so TalkBack reads a church as a church.
    val description = listOfNotNull(church.name, church.publicSummary, place, distance)
        .joinToString(", ")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(theme.palette.surface, RoundedCornerShape(FaithfulTokens.Radius.lg))
            .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithfulTokens.Radius.lg))
            .clickable(onClick = onOpen)
            .padding(FaithfulTokens.Spacing.base)
            .semantics(mergeDescendants = true) { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)
    ) {
        Text(church.name, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
        church.publicSummary?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary, maxLines = 2)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm)) {
            if (place.isNotBlank()) {
                Text(place, style = MaterialTheme.typography.labelSmall, color = theme.mutedContent)
            }
            distance?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.labelLarge,
                    color = theme.palette.contentSecondary,
                    modifier = Modifier
                        .background(theme.palette.surfaceSunken, RoundedCornerShape(FaithfulTokens.Radius.pill))
                        .padding(horizontal = FaithfulTokens.Spacing.sm, vertical = FaithfulTokens.Spacing.xs)
                )
            }
        }
    }
}

@Composable
fun SkeletonCard() {
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(theme.palette.surface, RoundedCornerShape(FaithfulTokens.Radius.lg))
            .padding(FaithfulTokens.Spacing.base),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm)
    ) {
        Spacer(
            Modifier
                .fillMaxWidth(0.6f)
                .heightIn(min = FaithfulTokens.Spacing.base)
                .background(theme.palette.skeletonBase, RoundedCornerShape(FaithfulTokens.Radius.sm))
        )
        Spacer(
            Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.Spacing.md)
                .background(theme.palette.skeletonBase, RoundedCornerShape(FaithfulTokens.Radius.sm))
        )
    }
}

/**
 * The one empty state, shared.
 *
 * [icon] is decorative and hidden from TalkBack — the title and body already
 * carry the whole message, and a glyph that announced itself would say the
 * same thing twice. Mirrors `EmptyStateView` on iOS, glyph for glyph.
 */
@Composable
fun EmptyState(
    title: String,
    body: String,
    icon: ImageVector? = null,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null
) {
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(FaithfulTokens.Spacing.xl)
            .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)
    ) {
        if (icon != null) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(FaithfulTokens.IconSize.sizeHero + FaithfulTokens.Spacing.lg * 2)
                    .background(theme.palette.brandAccent.copy(alpha = 0.14f), CircleShape)
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = theme.palette.brandPrimary,
                    modifier = Modifier.size(FaithfulTokens.IconSize.sizeLarge)
                )
            }
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm)
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary,
                textAlign = TextAlign.Center
            )
        }
        if (onRetry != null) {
            OutlinedButton(onClick = onRetry) {
                Text(stringResource(R.string.try_again))
            }
        }
    }
}
