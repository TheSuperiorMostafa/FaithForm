package io.faithform.app.ui.host

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.faithform.app.R
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.church.ChurchAvatar

/**
 * A tab's own title bar, with a back arrow when the tab has gone deeper than
 * its root.
 *
 * Each tab draws its own rather than the shell drawing one for all of them,
 * so the tab that knows where "back" leads is the one that handles it — the
 * arrow and the system back gesture call the same [onBack]. No insets are
 * applied here: the shell's scaffold has already placed the whole tab below
 * the status bar. [actions] sit at the trailing end. [onTitleClick] makes the
 * title and logo a single button, used by Home to open the church profile.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabScreen(
    title: String,
    subtitle: String? = null,
    logoUrl: String? = null,
    showChurchAvatar: Boolean = false,
    avatarUrl: String? = null,
    showAvatar: Boolean = false,
    onBack: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
    onTitleClick: (() -> Unit)? = null,
    titleClickLabel: String? = null,
    // Drawn behind the title bar as well as the content, so a screen with a
    // header wash reads as one surface instead of stopping at a seam under
    // the bar. The bar goes transparent whenever this is supplied.
    behind: (@Composable BoxScope.() -> Unit)? = null,
    content: @Composable (Modifier) -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    if (onBack != null) BackHandler(onBack = onBack)

    Box(modifier.fillMaxSize()) {
    if (behind != null) behind()
    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Row(
                    modifier = if (onTitleClick != null) {
                        Modifier
                            .heightIn(min = FaithFormTokens.TouchTarget.recommended)
                            .clickable(
                                role = Role.Button,
                                onClickLabel = titleClickLabel,
                                onClick = onTitleClick,
                            )
                    } else Modifier,
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                ) {
                    if (showChurchAvatar || showAvatar || !logoUrl.isNullOrBlank() || !avatarUrl.isNullOrBlank()) {
                        ChurchAvatar(
                            logoUrl = avatarUrl ?: logoUrl,
                            name = title,
                            size = if (subtitle != null) 34.dp else 28.dp,
                        )
                    }
                    // A subtitle turns the title into two stacked lines — the
                    // group conversation uses it to say how many people are
                    // in the room without a second bar.
                    Column {
                        Text(
                            title,
                            style = if (subtitle != null) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleLarge,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (subtitle != null) {
                            Text(
                                subtitle,
                                style = MaterialTheme.typography.labelSmall,
                                color = theme.palette.contentSecondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            },
            navigationIcon = {
                if (onBack != null) {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.nav_back),
                        )
                    }
                }
            },
            actions = actions,
            windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = if (behind != null) Color.Transparent else theme.palette.background,
                titleContentColor = theme.palette.contentPrimary,
                navigationIconContentColor = theme.palette.contentPrimary,
                actionIconContentColor = theme.palette.contentPrimary,
            ),
        )
        content(Modifier.weight(1f))
    }
    }
}
