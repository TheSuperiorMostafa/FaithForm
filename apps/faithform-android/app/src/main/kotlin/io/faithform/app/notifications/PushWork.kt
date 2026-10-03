package io.faithform.app.notifications

import android.content.Context
import androidx.work.*
import io.faithform.app.session.AppContainer
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

/** Retries registration after a token changes while the app is closed or offline. */
class PushRegistrationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = AppContainer.from(applicationContext) ?: return Result.success()
        if (container.sessionStore.current() == null) return Result.success()
        return try {
            container.push.synchronize()
            if (container.push.deliveryError.value != null && runAttemptCount < 5) Result.retry() else Result.success()
        } catch (cancelled: CancellationException) { throw cancelled }
    }
}

object PushWork {
    private const val NAME = "faithform.push.registration"
    fun enqueue(context: Context) {
        val request = OneTimeWorkRequestBuilder<PushRegistrationWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.KEEP, request)
    }
    fun cancel(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(NAME) }
}
