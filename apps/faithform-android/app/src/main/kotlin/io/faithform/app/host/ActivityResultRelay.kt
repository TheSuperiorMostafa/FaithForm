package io.faithform.app.host

import kotlin.coroutines.resume
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * A system dialog or sheet, asked for by something that outlives the Activity.
 *
 * ## The bug this exists to prevent
 *
 * An activity-result launcher belongs to one Activity instance and must be
 * registered before it starts. The things that want an answer — the discovery
 * model asking for location, the giving model presenting Stripe's sheet —
 * belong to ViewModels, which survive rotation. Handing a ViewModel the
 * launcher of the Activity that created it means that after one rotation it
 * holds a launcher attached to a destroyed Activity: the dialog either never
 * appears or its answer is delivered to a callback nobody is listening to, and
 * the coroutine waiting for it waits forever.
 *
 * So the ViewModel holds this relay instead, which lives in the application
 * container. Each Activity [attach]es its own freshly registered launcher in
 * `onCreate` and [detach]es it when destroyed. A request made before a rotation
 * is still answered after it: the pending continuation is kept here, not in
 * the Activity, and whichever Activity instance receives the system's result
 * calls [deliver].
 *
 * ## Threading
 *
 * Launchers and results live on the main thread; the lock only makes the
 * bookkeeping safe to call from a coroutine on another dispatcher.
 *
 * @param unavailable what [request] answers when no Activity is attached to ask
 *   — a permission refused, a payment sheet failed. Never a hang.
 */
class ActivityResultRelay<I, O>(private val unavailable: O) {

    private val lock = Any()
    private var launcher: ((I) -> Unit)? = null
    private var pending: CancellableContinuation<O>? = null

    /** Binds the current Activity's launcher, replacing any previous one. */
    fun attach(launch: (I) -> Unit) = synchronized(lock) { launcher = launch }

    /**
     * Unbinds [launch] — only if it is still the one attached. A destroyed
     * Activity's `onDestroy` can run *after* its replacement's `onCreate`, and
     * must not unbind the replacement.
     */
    fun detach(launch: (I) -> Unit) = synchronized(lock) {
        if (launcher === launch) launcher = null
    }

    val isAttached: Boolean get() = synchronized(lock) { launcher != null }

    /** Raises the dialog through whichever Activity is attached, and waits for its answer. */
    suspend fun request(input: I): O = suspendCancellableCoroutine { continuation ->
        val launch = synchronized(lock) {
            val current = launcher
            if (current != null) {
                // A second request supersedes the first. The first is answered
                // "unavailable" rather than left waiting for a dialog that was
                // replaced.
                pending?.let { previous -> if (previous.isActive) previous.resume(unavailable) }
                pending = continuation
            }
            current
        }
        if (launch == null) {
            continuation.resume(unavailable)
            return@suspendCancellableCoroutine
        }
        continuation.invokeOnCancellation {
            synchronized(lock) { if (pending === continuation) pending = null }
        }
        launch(input)
    }

    /** The system's answer, from whichever Activity instance received it. */
    fun deliver(output: O) {
        val waiting = synchronized(lock) { pending.also { pending = null } } ?: return
        if (waiting.isActive) waiting.resume(output)
    }
}
