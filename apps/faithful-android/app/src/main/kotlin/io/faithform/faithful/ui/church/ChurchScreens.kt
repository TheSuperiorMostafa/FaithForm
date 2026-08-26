package io.faithform.faithful.ui.church

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import io.faithform.faithful.R
import io.faithform.faithful.contract.ChurchProfile
import io.faithform.faithful.contract.RelationshipState
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.design.LocalFaithfulTheme
import io.faithform.faithful.ui.discovery.EmptyState
import io.faithform.faithful.ui.discovery.SkeletonCard

/**
 * The church profile someone reads before deciding to follow or join.
 *
 * Same information hierarchy as the SwiftUI `ChurchProfileView` — identity,
 * action, where and when, contact — rendered with Android-native components.
 */
@Composable
fun ChurchProfileScreen(
    phase: ChurchProfilePhase,
    isActing: Boolean,
    actionError: String?,
    onFollow: () -> Unit,
    onRequestJoin: () -> Unit,
    onLeave: () -> Unit,
    onAcceptInvitation: () -> Unit,
    onRetry: () -> Unit
) {
    val theme = LocalFaithfulTheme.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .verticalScroll(rememberScrollState())
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg)
    ) {
        when (phase) {
            is ChurchProfilePhase.Loading -> repeat(3) { SkeletonCard() }

            is ChurchProfilePhase.Loaded -> {
                Identity(phase.profile)
                ActionSection(
                    profile = phase.profile,
                    isActing = isActing,
                    actionError = actionError,
                    onFollow = onFollow,
                    onRequestJoin = onRequestJoin,
                    onLeave = onLeave,
                    onAcceptInvitation = onAcceptInvitation
                )
                if (phase.profile.campuses.isNotEmpty()) CampusSection(phase.profile)
                ContactSection(phase.profile)
            }

            // A hidden church and an unknown slug read identically, on purpose.
            is ChurchProfilePhase.NotFound -> EmptyState(
                stringResource(R.string.no_results_title),
                stringResource(R.string.no_results_body)
            )

            is ChurchProfilePhase.Offline -> EmptyState(
                stringResource(R.string.offline_title),
                stringResource(R.string.offline_body)
            )

            is ChurchProfilePhase.Failed -> {
                EmptyState(stringResource(R.string.error_title), phase.message)
                OutlinedButton(
                    onClick = onRetry,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = FaithfulTokens.TouchTarget.recommended)
                ) { Text(stringResource(R.string.try_again)) }
            }
        }
    }
}

@Composable
private fun Identity(profile: ChurchProfile) {
    val theme = LocalFaithfulTheme.current
    val state = profile.relationshipState?.let { stringResource(it.labelRes()) }
    val description = listOfNotNull(profile.name, profile.tagline, profile.publicSummary, state)
        .joinToString(", ")

    Column(
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = description
        }
    ) {
        Text(
            profile.name,
            style = MaterialTheme.typography.displayLarge,
            color = theme.palette.contentPrimary
        )
        profile.tagline?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.titleMedium, color = theme.palette.brandAccent)
        }
        profile.publicSummary?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodyLarge, color = theme.palette.contentSecondary)
        }
        state?.let { Chip(it, isDanger = profile.relationshipState == RelationshipState.BLOCKED) }
    }
}

@Composable
private fun ActionSection(
    profile: ChurchProfile,
    isActing: Boolean,
    actionError: String?,
    onFollow: () -> Unit,
    onRequestJoin: () -> Unit,
    onLeave: () -> Unit,
    onAcceptInvitation: () -> Unit
) {
    val theme = LocalFaithfulTheme.current
    val fill = Modifier
        .fillMaxWidth()
        .heightIn(min = FaithfulTokens.TouchTarget.recommended)

    Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm)) {
        when (ChurchActions.forProfile(profile)) {
            ChurchAction.FOLLOW ->
                Button(onClick = onFollow, enabled = !isActing, modifier = fill) {
                    Text(stringResource(R.string.follow_church))
                }

            ChurchAction.JOIN_IMMEDIATELY ->
                Button(onClick = onRequestJoin, enabled = !isActing, modifier = fill) {
                    Text(stringResource(R.string.join_church))
                }

            ChurchAction.REQUEST_TO_JOIN ->
                Button(onClick = onRequestJoin, enabled = !isActing, modifier = fill) {
                    Text(stringResource(R.string.request_to_join))
                }

            ChurchAction.INVITATION_REQUIRED -> {
                Text(
                    stringResource(R.string.invite_only_explainer),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentSecondary
                )
                OutlinedButton(onClick = onAcceptInvitation, modifier = fill) {
                    Text(stringResource(R.string.accept_invitation))
                }
            }

            // A pending request does not stop someone following along.
            ChurchAction.PENDING -> Text(
                stringResource(R.string.pending_explainer),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary
            )

            ChurchAction.LEAVE ->
                OutlinedButton(onClick = onLeave, enabled = !isActing, modifier = fill) {
                    Text(stringResource(R.string.leave_church))
                }

            ChurchAction.UNAVAILABLE -> Text(
                stringResource(R.string.blocked_body),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary
            )
        }

        actionError?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = theme.palette.destructive)
        }
    }
}

@Composable
private fun CampusSection(profile: ChurchProfile) {
    val theme = LocalFaithfulTheme.current
    val dayNames = listOf(
        stringResource(R.string.day_sunday),
        stringResource(R.string.day_monday),
        stringResource(R.string.day_tuesday),
        stringResource(R.string.day_wednesday),
        stringResource(R.string.day_thursday),
        stringResource(R.string.day_friday),
        stringResource(R.string.day_saturday)
    )

    Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)) {
        Text(
            stringResource(R.string.where_we_meet),
            style = MaterialTheme.typography.labelLarge,
            color = theme.mutedContent
        )

        profile.campuses.forEach { campus ->
            val services = profile.serviceTimes.filter { it.campusSlug == campus.slug }
            val description = listOfNotNull(
                campus.name,
                ChurchActions.addressLine(campus)
            ).plus(services.map { ChurchActions.serviceLine(it, dayNames) }).joinToString(", ")

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(theme.palette.surface, RoundedCornerShape(FaithfulTokens.Radius.lg))
                    .border(
                        theme.borderWidth,
                        theme.palette.border,
                        RoundedCornerShape(FaithfulTokens.Radius.lg)
                    )
                    .padding(FaithfulTokens.Spacing.base)
                    .semantics(mergeDescendants = true) { contentDescription = description },
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        campus.name,
                        style = MaterialTheme.typography.titleMedium,
                        color = theme.palette.contentPrimary
                    )
                    if (campus.isPrimary) Chip(stringResource(R.string.main_campus))
                }

                ChurchActions.addressLine(campus)?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = theme.palette.contentSecondary
                    )
                }

                // Service times are shown in the campus's own zone — "10:00"
                // means the church's ten, not the reader's.
                services.forEach { service ->
                    Text(
                        ChurchActions.serviceLine(service, dayNames),
                        style = MaterialTheme.typography.bodyMedium,
                        color = theme.palette.brandAccent
                    )
                }
            }
        }
    }
}

@Composable
private fun ContactSection(profile: ChurchProfile) {
    val theme = LocalFaithfulTheme.current
    val rows = listOfNotNull(
        profile.website?.let { stringResource(R.string.website_label) to it },
        profile.phone?.let { stringResource(R.string.phone_label) to it },
        profile.email?.let { stringResource(R.string.email_label) to it }
    )
    if (rows.isEmpty()) return

    Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm)) {
        Text(
            stringResource(R.string.get_in_touch),
            style = MaterialTheme.typography.labelLarge,
            color = theme.mutedContent
        )
        rows.forEach { (label, value) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics(mergeDescendants = true) { contentDescription = "$label: $value" }
            ) {
                Text(label, style = MaterialTheme.typography.labelSmall, color = theme.mutedContent)
                Spacer(Modifier.weight(1f))
                Text(
                    value,
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentPrimary
                )
            }
        }
    }
}

/**
 * Choosing between the churches an account belongs to.
 *
 * Switching changes the cache partition, so the previous church's private
 * content becomes unreadable rather than merely hidden.
 */
@Composable
fun ChurchChooserScreen(
    phase: ChooserPhase,
    selectedSlug: String?,
    onSelect: (String) -> Unit,
    onAddAnother: () -> Unit
) {
    val theme = LocalFaithfulTheme.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.base)
    ) {
        Text(
            stringResource(R.string.choose_church_title),
            style = MaterialTheme.typography.displayMedium,
            color = theme.palette.contentPrimary
        )

        when (phase) {
            is ChooserPhase.Loading -> repeat(2) { SkeletonCard() }

            is ChooserPhase.Loaded -> LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)
            ) {
                items(phase.churches, key = { it.slug }) { church ->
                    ChooserRow(church, church.slug == selectedSlug) { onSelect(church.slug) }
                }
            }

            is ChooserPhase.Empty -> EmptyState(
                stringResource(R.string.no_churches_title),
                stringResource(R.string.no_churches_body)
            )
            is ChooserPhase.Offline -> EmptyState(
                stringResource(R.string.offline_title),
                stringResource(R.string.offline_body)
            )
            is ChooserPhase.Failed -> EmptyState(
                stringResource(R.string.error_title),
                phase.message
            )
        }

        OutlinedButton(
            onClick = onAddAnother,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) { Text(stringResource(R.string.add_another_church)) }
    }
}

@Composable
private fun ChooserRow(church: ChooserChurch, isSelected: Boolean, onSelect: () -> Unit) {
    val theme = LocalFaithfulTheme.current
    val selectable = church.isSelectable()
    val stateLabel = stringResource(church.state.labelRes())

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(theme.palette.surface, RoundedCornerShape(FaithfulTokens.Radius.lg))
            .border(
                theme.borderWidth,
                if (isSelected) theme.palette.brandAccent else theme.palette.border,
                RoundedCornerShape(FaithfulTokens.Radius.lg)
            )
            .then(if (selectable) Modifier.clickable(onClick = onSelect) else Modifier)
            .padding(FaithfulTokens.Spacing.base)
            .semantics(mergeDescendants = true) {
                contentDescription = "${church.name}, $stateLabel"
                selected = isSelected
            },
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)
        ) {
            Text(
                church.name,
                style = MaterialTheme.typography.titleMedium,
                color = if (selectable) theme.palette.contentPrimary else theme.mutedContent
            )
            Chip(stateLabel, isDanger = church.state == RelationshipState.BLOCKED)
        }
        if (isSelected) {
            Text("✓", style = MaterialTheme.typography.titleLarge, color = theme.palette.brandAccent)
        }
    }
}

@Composable
private fun Chip(text: String, isDanger: Boolean = false) {
    val theme = LocalFaithfulTheme.current
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = if (isDanger) theme.palette.destructiveContent else theme.palette.contentSecondary,
        modifier = Modifier
            .background(
                if (isDanger) theme.palette.destructive else theme.palette.surfaceSunken,
                RoundedCornerShape(FaithfulTokens.Radius.pill)
            )
            .padding(
                horizontal = FaithfulTokens.Spacing.sm,
                vertical = FaithfulTokens.Spacing.xs
            )
    )
}

fun RelationshipState.labelRes(): Int = when (this) {
    RelationshipState.FOLLOWING -> R.string.state_following
    RelationshipState.PENDING -> R.string.state_pending
    RelationshipState.JOINED -> R.string.state_joined
    RelationshipState.LEFT -> R.string.state_left
    RelationshipState.BLOCKED -> R.string.state_blocked
    RelationshipState.UNKNOWN -> R.string.state_left
}
