package io.faithform.app.ui.brand

import android.provider.Settings
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
    val animationsRemoved = Settings.Global.getFloat(
        context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f,
    ) == 0f
    return theme.reduceMotion || animationsRemoved
}

/** Observe Android's accessibility setting once at the app root. */
@Composable
internal fun rememberSystemReducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    fun read() = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    var reduced by remember(resolver) { mutableStateOf(read()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { reduced = read() }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return reduced
}
