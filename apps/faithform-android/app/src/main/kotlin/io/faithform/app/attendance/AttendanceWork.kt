package io.faithform.app.attendance

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import io.faithform.app.session.AppContainer
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Background work for automatic attendance, on WorkManager.
 *
 * **What is here, and what is deliberately not.**
 *
 * * Every request is **one-time** and **unique by name**, so a burst of
 *   broadcasts cannot stack work, and a replacement supersedes rather than
 *   duplicates.
 * * Anything that talks to the server waits for a **network** and backs off
 *   **exponentially** from thirty seconds. A congregation's phones reach the
 *   same building within minutes, and WorkManager's backoff spreads them out.
 * * **No periodic work.** Nothing wakes on a timer to look for church: the
 *   system's geofencing does the watching.
 * * **No expedited or foreground work.** Below Android 12 expedited work is a
 *   foreground service, and the manifest removes WorkManager's foreground
 *   service and its permission outright.
 * * **No location in any request.** Input data is a task name and, at most, a
 *   trigger name. Transitions wait in the encrypted inbox.
 */
class WorkManagerAttendanceScheduler(private val context: Context) : AttendanceScheduler {

    private val work: WorkManager get() = WorkManager.getInstance(context)

    override fun processTransitions() {
        work.enqueueUniqueWork(
            NAME_TRANSITIONS,
            // Appended, never dropped: a transition that arrives while the
            // previous pass is running is handled by the pass after it.
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request(TASK_TRANSITIONS, network = false),
        )
    }

    override fun retryWhenOnline() {
        work.enqueueUniqueWork(NAME_RETRY, ExistingWorkPolicy.KEEP, request(TASK_RETRY, network = true))
    }

    override fun promptAt(epochMillis: Long) {
        work.enqueueUniqueWork(
            NAME_PROMPT,
            ExistingWorkPolicy.REPLACE,
            request(TASK_PROMPT, network = false, atEpochMillis = epochMillis),
        )
    }

    override fun confirmWhenOnline(atEpochMillis: Long?) {
        work.enqueueUniqueWork(
            NAME_CONFIRM,
            ExistingWorkPolicy.REPLACE,
            request(TASK_CONFIRM, network = true, atEpochMillis = atEpochMillis),
        )
    }

    override fun reconcileWhenOnline(trigger: ReconcileTrigger, atEpochMillis: Long?) {
        val name = when (trigger) {
            ReconcileTrigger.WindowBoundary -> NAME_WINDOW
            else -> NAME_RECONCILE_PREFIX + trigger.name
        }
        work.enqueueUniqueWork(
            name,
            ExistingWorkPolicy.REPLACE,
            request(
                TASK_RECONCILE,
                // Removing fences needs no network; registering them needs a
                // fresh configuration.
                network = trigger != ReconcileTrigger.Teardown,
                atEpochMillis = atEpochMillis,
                trigger = trigger,
            ),
        )
    }

    override fun rearmAt(epochMillis: Long) {
        work.enqueueUniqueWork(
            NAME_REARM,
            ExistingWorkPolicy.REPLACE,
            request(TASK_RECONCILE, network = true, atEpochMillis = epochMillis, trigger = ReconcileTrigger.WindowBoundary),
        )
    }

    override fun revokeConsentWhenOnline() {
        work.enqueueUniqueWork(NAME_REVOKE, ExistingWorkPolicy.KEEP, request(TASK_REVOKE, network = true))
    }

    override fun cancelAll() {
        work.cancelAllWorkByTag(TAG)
    }

    private fun request(
        task: String,
        network: Boolean,
        atEpochMillis: Long? = null,
        trigger: ReconcileTrigger? = null,
    ): OneTimeWorkRequest {
        val builder = OneTimeWorkRequestBuilder<AttendanceWorker>()
            .addTag(TAG)
            .setInputData(
                if (trigger != null) {
                    workDataOf(KEY_TASK to task, KEY_TRIGGER to trigger.name)
                } else {
                    workDataOf(KEY_TASK to task)
                },
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
        if (network) {
            builder.setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        }
        atEpochMillis?.let { at ->
            val delay = at - System.currentTimeMillis()
            if (delay > 0) builder.setInitialDelay(delay, TimeUnit.MILLISECONDS)
        }
        return builder.build()
    }

    companion object {
        const val TAG = "faithform.attendance"
        const val NAME_TRANSITIONS = "faithform.attendance.transitions"
        const val NAME_RETRY = "faithform.attendance.retry"
        const val NAME_PROMPT = "faithform.attendance.prompt"
        const val NAME_CONFIRM = "faithform.attendance.confirm"
        const val NAME_WINDOW = "faithform.attendance.window"
        const val NAME_REARM = "faithform.attendance.rearm"
        const val NAME_REVOKE = "faithform.attendance.revoke"
        const val NAME_RECONCILE_PREFIX = "faithform.attendance.reconcile."

        const val KEY_TASK = "task"
        const val KEY_TRIGGER = "trigger"

        const val TASK_TRANSITIONS = "transitions"
        const val TASK_RETRY = "retry"
        const val TASK_PROMPT = "prompt"
        const val TASK_CONFIRM = "confirm"
        const val TASK_RECONCILE = "reconcile"
        const val TASK_REVOKE = "revoke"

        const val BACKOFF_SECONDS = 30L

        /**
         * Runs of one request before it gives up. With thirty-second
         * exponential backoff this spans well over the two hours an attempt
         * lives, so the attempt's own expiry, not this, is what normally ends
         * a retry.
         */
        const val MAX_RUNS = 12
    }
}

/**
 * The one worker, told what to do by its input.
 *
 * Constructed by WorkManager's default factory, in whatever process is
 * running — often one started just for it — and finds the app's graph through
 * the container like the receivers do.
 */
class AttendanceWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val runtime = AppContainer.from(applicationContext)?.automaticAttendance ?: return Result.success()
        val engine = runtime.engine

        val outcome = when (inputData.getString(WorkManagerAttendanceScheduler.KEY_TASK)) {
            WorkManagerAttendanceScheduler.TASK_TRANSITIONS -> {
                // Anything this pass could not finish, it has already handed
                // to network-constrained retry work.
                engine.processTransitions()
                WorkResult.Done
            }
            WorkManagerAttendanceScheduler.TASK_RETRY -> engine.retryPending()
            WorkManagerAttendanceScheduler.TASK_PROMPT -> {
                engine.askIfStillPending()
                WorkResult.Done
            }
            WorkManagerAttendanceScheduler.TASK_CONFIRM -> engine.confirmArrival()
            WorkManagerAttendanceScheduler.TASK_RECONCILE -> {
                val trigger = inputData.getString(WorkManagerAttendanceScheduler.KEY_TRIGGER)
                    ?.let { name -> ReconcileTrigger.entries.firstOrNull { it.name == name } }
                    ?: ReconcileTrigger.ConfigurationRefreshed
                engine.reconcile(trigger)
            }
            WorkManagerAttendanceScheduler.TASK_REVOKE -> engine.revokePendingConsent()
            else -> WorkResult.Done
        }

        return when {
            outcome == WorkResult.Done -> Result.success()
            runAttemptCount + 1 >= WorkManagerAttendanceScheduler.MAX_RUNS -> Result.success()
            else -> Result.retry()
        }
    }
}

/**
 * The receivers' way in.
 *
 * A receiver has milliseconds of its own and about ten seconds with `goAsync`.
 * This does the two things that fit — write the transition to the encrypted
 * inbox, enqueue work — and nothing else.
 */
class AttendanceWakeups(
    private val runtime: () -> AutomaticAttendanceRuntime,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    fun recordTransition(kind: TransitionKind, regionIds: List<String>, done: () -> Unit) {
        scope.launch {
            try {
                runtime().engine.recordTransition(kind, regionIds)
            } finally {
                done()
            }
        }
    }

    fun reconcileSoon(trigger: ReconcileTrigger) {
        runtime().scheduler.reconcileWhenOnline(trigger)
    }

    /** "Check in" on the question. Acknowledged at once, sent by work. */
    fun personConfirmed() {
        val current = runtime()
        current.notifier.checking()
        current.scheduler.confirmWhenOnline()
    }

    companion object {
        fun from(context: Context): AttendanceWakeups? = AppContainer.from(context)?.attendanceWakeups
    }
}
