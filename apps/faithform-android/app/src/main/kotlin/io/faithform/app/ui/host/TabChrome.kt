package io.faithform.app.ui.host

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import io.faithform.app.R
import io.faithform.app.design.LocalFaithFormTheme

/**
 * A tab's own title bar, with a back arrow when the tab has gone deeper than
 * its root.
 *
 * Each tab draws its own rather than the shell drawing one for all of them,
 * so the tab that knows where "back" leads is the one that handles it — the
 * arrow and the system back gesture call the same [onBack]. No insets are
 * applied here: the shell's scaffold has already placed the whole tab below
 * the status bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabScreen(
    title: String,
    onBack: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    content: @Composable (Modifier) -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    if (onBack != null) BackHandler(onBack = onBack)

    Column(modifier = modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Text(
                    title,
                    style = MaterialTheme.typography.titleLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
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
            windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = theme.palette.background,
                titleContentColor = theme.palette.contentPrimary,
                navigationIconContentColor = theme.palette.contentPrimary,
            ),
        )
        content(Modifier.weight(1f))
    }
}
