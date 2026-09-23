package io.faithform.app.ui.discovery

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import io.faithform.app.R
import io.faithform.app.contract.DiscoveredChurch
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.brand.FaithFormMark
import io.faithform.app.ui.components.DiscoveryResultsSkeleton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Church
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff

/**
 * The welcome screen someone sees with no church yet.
 *
 * Invitation first — FaithForm is the church's app for their people.
 * Search stays available as a secondary door when a church has turned listing on.
 */
@Composable
fun WelcomeScreen(onFindChurch: () -> Unit, onHaveInvitation: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(top = FaithFormTokens.Spacing.lg, bottom = FaithFormTokens.Spacing.xxl),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xl)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)
            ) {
                FaithFormMark(Modifier.height(32.dp))
                Text(
                    stringResource(R.string.app_name),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = theme.palette.contentPrimary
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "WELCOME HOME",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = theme.palette.brandAccent
                )
                Text(
                    "Find your church community.",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = theme.palette.contentPrimary
                )
            }

            Text(
                "Connect with your congregation, follow announcements, join groups, and worship together wherever you are.",
                style = MaterialTheme.typography.bodyLarge,
                color = theme.palette.contentSecondary
            )
        }

        Surface(
            color = theme.palette.surface,
            shape = RoundedCornerShape(24.dp),
            border = BorderStroke(theme.borderWidth, theme.palette.border),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                WelcomeFeatureRow(
                    icon = Icons.Outlined.Church,
                    title = "Your Church Home",
                    detail = "Access weekly sermons, live broadcasts, and church-wide announcements."
                )
                Box(Modifier.fillMaxWidth().height(theme.borderWidth).background(theme.palette.border))
                WelcomeFeatureRow(
                    icon = Icons.Outlined.Groups,
                    title = "Community & Groups",
                    detail = "Build real relationships in small groups and direct messaging."
                )
                Box(Modifier.fillMaxWidth().height(theme.borderWidth).background(theme.palette.border))
                WelcomeFeatureRow(
                    icon = Icons.Outlined.FavoriteBorder,
                    title = "Check-In & Giving",
                    detail = "Touchless Sunday morning check-in and simple, secure generosity."
                )
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
            Button(
                onClick = onFindChurch,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithFormTokens.TouchTarget.recommended),
                shape = RoundedCornerShape(FaithFormTokens.Radius.control),
                colors = ButtonDefaults.buttonColors(
                    containerColor = theme.palette.brandAccent,
                    contentColor = theme.palette.contentOnAccent
                )
            ) {
                Icon(Icons.Outlined.Search, contentDescription = null, modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium))
                Spacer(Modifier.size(FaithFormTokens.Spacing.sm))
                Text(stringResource(R.string.find_a_church), style = MaterialTheme.typography.titleMedium)
            }

            OutlinedButton(
                onClick = onHaveInvitation,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithFormTokens.TouchTarget.recommended),
                shape = RoundedCornerShape(FaithFormTokens.Radius.control),
                border = BorderStroke(theme.borderWidth, theme.palette.brandPrimary.copy(alpha = 0.45f))
            ) {
                Icon(Icons.Outlined.MarkEmailUnread, contentDescription = null, modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium), tint = theme.palette.contentPrimary)
                Spacer(Modifier.size(FaithFormTokens.Spacing.sm))
                Text(stringResource(R.string.have_invitation), style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
            }
        }
    }
}

@Composable
private fun WelcomeFeatureRow(icon: ImageVector, title: String, detail: String) {
    val theme = LocalFaithFormTheme.current
    Row(
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(44.dp)
                .background(theme.palette.brandAccent.copy(alpha = 0.14f), RoundedCornerShape(14.dp))
        ) {
            Icon(icon, contentDescription = null, tint = theme.palette.brandAccent, modifier = Modifier.size(22.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = theme.palette.contentPrimary)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = theme.palette.contentSecondary)
        }
    }
}

/** Why location is being asked for, before the runtime dialog is raised. */
@Composable
fun LocationEducationScreen(onContinue: () -> Unit, onSkip: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg)
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
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
        ) { Text(stringResource(R.string.location_continue)) }
        OutlinedButton(
            onClick = onSkip,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
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
    val theme = LocalFaithFormTheme.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base)
    ) {
        val searchHint = stringResource(R.string.search_placeholder)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(theme.palette.surfaceSunken, RoundedCornerShape(FaithFormTokens.Radius.control))
                .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithFormTokens.Radius.control))
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
                .padding(horizontal = FaithFormTokens.Spacing.base),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)
        ) {
            Icon(Icons.Outlined.Search, contentDescription = null, tint = theme.palette.brandAccent, modifier = Modifier.size(20.dp))
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = TextStyle(color = theme.palette.contentPrimary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                modifier = Modifier.weight(1f)
            )
            if (query.isNotBlank()) {
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = "Clear search",
                    tint = theme.palette.contentSecondary,
                    modifier = Modifier
                        .size(20.dp)
                        .clickable { onQueryChange(""); onSearch() }
                )
            }
        }

        when (phase) {
            is DiscoveryPhase.Idle -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg)
            ) {
                Surface(
                    color = theme.palette.surface,
                    shape = RoundedCornerShape(20.dp),
                    border = BorderStroke(theme.borderWidth, theme.palette.border),
                    onClick = onNearby,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(52.dp)
                                .background(theme.palette.brandAccent.copy(alpha = 0.14f), RoundedCornerShape(16.dp))
                        ) {
                            Icon(Icons.Outlined.LocationOn, contentDescription = null, tint = theme.palette.brandAccent, modifier = Modifier.size(24.dp))
                        }
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(stringResource(R.string.churches_near_me), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = theme.palette.contentPrimary)
                            Text("Discover congregations active near you", style = MaterialTheme.typography.bodySmall, color = theme.palette.contentSecondary)
                        }
                        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = theme.palette.contentSecondary)
                    }
                }

                Surface(
                    color = theme.palette.surface,
                    shape = RoundedCornerShape(20.dp),
                    border = BorderStroke(theme.borderWidth, theme.palette.border),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            "HOW TO FIND YOUR CHURCH",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = theme.palette.brandAccent
                        )
                        DiscoveryTipRow(
                            icon = Icons.Outlined.Church,
                            title = "Search by Congregation Name",
                            detail = "Type your church, parish, or ministry name (e.g. \"Grace Chapel\")."
                        )
                        Box(Modifier.fillMaxWidth().height(theme.borderWidth).background(theme.palette.border))
                        DiscoveryTipRow(
                            icon = Icons.Outlined.LocationOn,
                            title = "Search by Location",
                            detail = "Enter your city, neighborhood, or postal code to browse local churches."
                        )
                        Box(Modifier.fillMaxWidth().height(theme.borderWidth).background(theme.palette.border))
                        DiscoveryTipRow(
                            icon = Icons.Outlined.MarkEmailUnread,
                            title = "Have an Invitation Link?",
                            detail = "Tap your church's email or SMS invitation link to join automatically."
                        )
                    }
                }
            }
            is DiscoveryPhase.Searching -> DiscoveryResultsSkeleton()

            is DiscoveryPhase.Results -> LazyColumn(
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)
            ) {
                items(phase.churches, key = { it.slug }) { church ->
                    ChurchResultCard(church) { onOpenChurch(church.slug) }
                }
            }

            is DiscoveryPhase.Empty -> Surface(
                color = theme.palette.surface,
                shape = RoundedCornerShape(20.dp),
                border = BorderStroke(theme.borderWidth, theme.palette.border),
                modifier = Modifier.fillMaxWidth().padding(top = FaithFormTokens.Spacing.base)
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(64.dp)
                            .background(theme.palette.brandAccent.copy(alpha = 0.14f), RoundedCornerShape(20.dp))
                    ) {
                        Icon(Icons.Outlined.SearchOff, contentDescription = null, tint = theme.palette.brandAccent, modifier = Modifier.size(28.dp))
                    }
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(stringResource(R.string.no_results_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = theme.palette.contentPrimary)
                        Text(stringResource(R.string.no_results_body), style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary, textAlign = TextAlign.Center)
                    }
                    Button(
                        onClick = onNearby,
                        shape = RoundedCornerShape(FaithFormTokens.Radius.control),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = theme.palette.brandAccent,
                            contentColor = theme.palette.contentOnAccent
                        )
                    ) {
                        Icon(Icons.Outlined.LocationOn, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.churches_near_me))
                    }
                }
            }
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
private fun DiscoveryTipRow(icon: ImageVector, title: String, detail: String) {
    val theme = LocalFaithFormTheme.current
    Row(
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(38.dp)
                .background(theme.palette.brandAccent.copy(alpha = 0.12f), RoundedCornerShape(12.dp))
        ) {
            Icon(icon, contentDescription = null, tint = theme.palette.brandAccent, modifier = Modifier.size(18.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = theme.palette.contentPrimary)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = theme.palette.contentSecondary)
        }
    }
}

@Composable
private fun ChurchResultCard(church: DiscoveredChurch, onOpen: () -> Unit) {
    val theme = LocalFaithFormTheme.current
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
            .background(theme.palette.surface, RoundedCornerShape(FaithFormTokens.Radius.lg))
            .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithFormTokens.Radius.lg))
            .clickable(onClick = onOpen)
            .padding(FaithFormTokens.Spacing.base)
            .semantics(mergeDescendants = true) { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
            verticalAlignment = Alignment.Top,
        ) {
            io.faithform.app.ui.church.ChurchAvatar(logoUrl = church.logoUrl, name = church.name)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
            ) {
                Text(church.name, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
                church.publicSummary?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary, maxLines = 2)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                    if (place.isNotBlank()) {
                        Text(place, style = MaterialTheme.typography.labelSmall, color = theme.mutedContent)
                    }
                    distance?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelLarge,
                            color = theme.palette.contentSecondary,
                            modifier = Modifier
                                .background(theme.palette.surfaceSunken, RoundedCornerShape(FaithFormTokens.Radius.pill))
                                .padding(horizontal = FaithFormTokens.Spacing.sm, vertical = FaithFormTokens.Spacing.xs)
                        )
                    }
                }
            }
        }
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
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(FaithFormTokens.Spacing.xl)
            .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)
    ) {
        if (icon != null) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(FaithFormTokens.IconSize.sizeHero + FaithFormTokens.Spacing.lg * 2)
                    .background(theme.palette.brandAccent.copy(alpha = 0.14f), CircleShape)
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = theme.palette.brandPrimary,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeLarge)
                )
            }
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
            if (body.isNotBlank()) {
                Text(
                    body,
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentSecondary,
                    textAlign = TextAlign.Center
                )
            }
        }
        if (onRetry != null) {
            OutlinedButton(onClick = onRetry) {
                Text(stringResource(R.string.try_again))
            }
        }
    }
}
