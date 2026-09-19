package io.faithform.app.ui.host

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.res.stringResource
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
 * the status bar. [actions] sit at the trailing end, like Home's "Church info".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabScreen(
    title: String,
    logoUrl: String? = null,
    showChurchAvatar: Boolean = false,
    onBack: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (Modifier) -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    if (onBack != null) BackHandler(onBack = onBack)

    Column(modifier = modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                ) {
                    if (showChurchAvatar || !logoUrl.isNullOrBlank()) {
                        ChurchAvatar(
                            logoUrl = logoUrl,
                            name = title,
                            size = 28.dp,
                        )
                    }
                    Text(
                        title,
                        style = MaterialTheme.typography.titleLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
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
                containerColor = theme.palette.background,
                titleContentColor = theme.palette.contentPrimary,
                navigationIconContentColor = theme.palette.contentPrimary,
                actionIconContentColor = theme.palette.contentPrimary,
            ),
        )
        content(Modifier.weight(1f))
    }
}
