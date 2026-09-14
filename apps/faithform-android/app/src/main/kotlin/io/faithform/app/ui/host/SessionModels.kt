package io.faithform.app.ui.host

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Everything a signed-in session holds in memory, in one place that can be
 * emptied at once.
 *
 * Feature models — a church's feed, its giving form, a sermon list — are kept
 * across rotation like any ViewModel. Kept in the *Activity's* store, though,
 * they would also outlive the account: sign out, sign in as someone else, open
 * the same church, and the previous person's giving history would still be
 * sitting in the model that answered to that key. So they live in this store
 * instead, which is itself retained across rotation and is cleared whenever the
 * signed-in account (or its authorization version) changes.
 */
class SessionScopeViewModel : ViewModel(), ViewModelStoreOwner {
    override val viewModelStore = ViewModelStore()

    private var owner: String? = null

    /** Clears every feature model when [key] names a different session than before. */
    fun bindTo(key: String?) {
        if (owner != key) {
            viewModelStore.clear()
            owner = key
        }
    }

    override fun onCleared() = viewModelStore.clear()
}

/**
 * One feature model with a coroutine scope that survives rotation.
 *
 * The models themselves are plain classes in the core modules, with suspend
 * functions a JVM test can call directly. This wrapper gives them a lifetime:
 * work started with [launch] continues across a configuration change and is
 * cancelled when the session scope is cleared.
 */
class SessionModel<T : Any>(
    val value: T,
    private val release: (T) -> Unit,
) : ViewModel() {
    private val started = mutableSetOf<String>()

    fun launch(block: suspend T.() -> Unit): Job = viewModelScope.launch { value.block() }

    /** Runs [block] the first time [tag] is seen for this model, and never again. */
    fun launchOnce(tag: String, block: suspend T.() -> Unit) {
        if (started.add(tag)) launch(block)
    }

    override fun onCleared() = release(value)
}

/**
 * The [SessionModel] for [key] in the nearest session scope, created by [create]
 * the first time it is asked for.
 */
@Composable
fun <T : Any> rememberSessionModel(
    key: String,
    release: (T) -> Unit = {},
    create: () -> T,
): SessionModel<T> {
    val owner = checkNotNull(LocalViewModelStoreOwner.current) { "no ViewModelStoreOwner" }
    return remember(owner, key) {
        val factory = object : ViewModelProvider.Factory {
            override fun <VM : ViewModel> create(modelClass: Class<VM>, extras: CreationExtras): VM {
                @Suppress("UNCHECKED_CAST")
                return SessionModel(create(), release) as VM
            }
        }
        @Suppress("UNCHECKED_CAST")
        ViewModelProvider(owner, factory)[key, SessionModel::class.java] as SessionModel<T>
    }
}
