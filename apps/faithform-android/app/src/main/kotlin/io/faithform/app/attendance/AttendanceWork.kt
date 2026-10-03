package io.faithform.app.attendance

import android.content.Context
import androidx.work.*
import io.faithform.app.session.AppContainer
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

/** Receiver work is durable and bounded; receivers themselves never wait for GPS or HTTP. */
class AttendanceWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val runtime = AppContainer.from(applicationContext)?.attendanceRuntime ?: return Result.success()
        return try {
            runtime.transition(inputData.getInt("transition", 0), inputData.getString("region"))
            Result.success()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { if (runAttemptCount < 3) Result.retry() else Result.failure() }
    }
}

object AttendanceWork {
    private const val EVENTS = "faithform.attendance.events"
    private const val CONFIRM = "faithform.attendance.confirm"
    private const val MAINTAIN = "faithform.attendance.maintenance"
    private const val TAG = "faithform.attendance"
    fun enqueue(context: Context, transition: Int = 0, region: String? = null) {
        val request = OneTimeWorkRequestBuilder<AttendanceWorker>()
            .setInputData(workDataOf("transition" to transition, "region" to region))
            .addTag(TAG).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork(EVENTS, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
    fun scheduleMaintenance(context: Context) {
        val request = PeriodicWorkRequestBuilder<AttendanceWorker>(15, TimeUnit.MINUTES)
            .setInputData(workDataOf("transition" to -1))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).addTag(TAG).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(MAINTAIN, ExistingPeriodicWorkPolicy.KEEP, request)
    }
    fun scheduleConfirmation(context: Context, due: Long) {
        val request = OneTimeWorkRequestBuilder<AttendanceWorker>()
            .setInputData(workDataOf("transition" to com.google.android.gms.location.Geofence.GEOFENCE_TRANSITION_DWELL))
            .setInitialDelay(maxOf(0, due - System.currentTimeMillis()), TimeUnit.MILLISECONDS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).addTag(TAG).build()
        // A server may extend dwell while this worker is running. KEEP would
        // discard that next wake because the current confirmation still exists.
        WorkManager.getInstance(context).enqueueUniqueWork(CONFIRM, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
    fun cancelConfirmation(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(CONFIRM) }
    fun cancelMaintenance(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(MAINTAIN) }
    fun cancelAll(context: Context) { WorkManager.getInstance(context).cancelAllWorkByTag(TAG) }
}
