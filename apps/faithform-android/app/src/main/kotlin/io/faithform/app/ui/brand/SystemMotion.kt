package io.faithform.app.ui.brand

import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import io.faithform.app.design.LocalFaithFormTheme

/**
 * Whether decorative motion should stand still.
 *
 * The theme's own flag, or Android's "Remove animations", which sets the
 * animator duration scale to zero. A slide or a pulse is decoration; nothing a
 * person needs is carried by one, so either setting turns it off.
 */
@Composable
internal fun rememberReducedMotion(): Boolean {
    val theme = LocalFaithFormTheme.current
    val context = LocalContext.current
    val animationsRemoved = remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
    return theme.reduceMotion || animationsRemoved
}
