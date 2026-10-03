package io.faithform.app.notifications

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import io.faithform.app.BuildConfig
import io.faithform.app.contract.DeviceInstallation
import io.faithform.app.contract.DevicePlatform
import io.faithform.app.contract.RegisterDeviceRequest
import io.faithform.app.network.FaithFormJson
import io.faithform.app.network.MobileSuccess
import io.faithform.app.session.AppContainer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class PushRuntime(private val context: Context, private val container: AppContainer) {
    private val lock = Mutex()
    private val devicePrefs = context.getSharedPreferences("faithform.installation.${container.environmentKey}", Context.MODE_PRIVATE)
    val installId: String = devicePrefs.getString("id", null) ?: UUID.randomUUID().toString().also { devicePrefs.edit().putString("id", it).apply() }
    private val _authorization = MutableStateFlow(status())
    val authorization = _authorization.asStateFlow()
    private val _deliveryError = MutableStateFlow<String?>(null)
    val deliveryError = _deliveryError.asStateFlow()
    private var registeredAccount: String? = null
    private var registeredToken: String? = null
    private var retiringAccessToken: String? = null

    fun status(): NotificationAuthorization {
        if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return if (Build.VERSION.SDK_INT < 33) NotificationAuthorization.NOT_REQUIRED else NotificationAuthorization.GRANTED
        }
        return if (devicePrefs.getBoolean("asked", false) || Build.VERSION.SDK_INT < 33) NotificationAuthorization.DENIED
        else NotificationAuthorization.NOT_REQUESTED
    }

    suspend fun request() {
        devicePrefs.edit().putBoolean("asked", true).apply()
        if (Build.VERSION.SDK_INT >= 33) container.locationPermissions.request(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
        synchronize()
    }

    suspend fun synchronize(token: String? = null) = lock.withLock {
        val state = status()
        _authorization.value = state
        if (FirebaseApp.getApps(context).isEmpty()) {
            _deliveryError.value = context.getString(io.faithform.app.R.string.notification_registration_pending)
            return@withLock
        }
        val session = container.sessionStore.current()
        if (session != null && session.accessToken == retiringAccessToken) return@withLock
        val account = session?.accountId
        if (account == null || state !in setOf(NotificationAuthorization.GRANTED, NotificationAuthorization.NOT_REQUIRED)) {
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
            if (account != null) runCatching { retireLocked() }
            return@withLock
        }
        try {
            FirebaseMessaging.getInstance().isAutoInitEnabled = true
            val currentToken = token ?: suspendCancellableCoroutine<String> { continuation ->
                FirebaseMessaging.getInstance().token.addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }
                    .addOnFailureListener { if (continuation.isActive) continuation.resumeWithException(it) }
            }
            // A token completing after sign-out belongs to nobody, never to a newer account.
            if (container.sessionStore.current()?.accountId != account) return@withLock
            if (registeredAccount == account && registeredToken == currentToken) return@withLock
            val request = RegisterDeviceRequest(installId, DevicePlatform.ANDROID, "fcm", currentToken,
                appVersion = BuildConfig.VERSION_NAME, clientBuild = BuildConfig.VERSION_CODE,
                osVersion = Build.VERSION.RELEASE, locale = Locale.getDefault().toLanguageTag())
            container.apiClient.send("api/mobile/v1/devices", MobileSuccess.serializer(DeviceInstallation.serializer()), method = "POST",
                body = FaithFormJson.encodeToString(RegisterDeviceRequest.serializer(), request)).value ?: error("registration_unavailable")
            registeredAccount = account
            registeredToken = currentToken
            _deliveryError.value = null
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            _deliveryError.value = context.getString(io.faithform.app.R.string.notification_registration_pending)
            PushWork.enqueue(context)
        }
    }

    @Serializable private data class Retired(val retired: Boolean)
    private suspend fun retireLocked() {
        container.apiClient.send("api/mobile/v1/devices", MobileSuccess.serializer(Retired.serializer()), method = "DELETE", query = mapOf("installId" to installId))
        registeredAccount = null; registeredToken = null
    }
    suspend fun clearLocal() = lock.withLock {
        PushWork.cancel(context)
        if (FirebaseApp.getApps(context).isNotEmpty()) FirebaseMessaging.getInstance().isAutoInitEnabled = false
        NotificationManagerCompat.from(context).cancelAll()
        registeredAccount = null; registeredToken = null
    }
    suspend fun beforeSignOut() = lock.withLock {
        PushWork.cancel(context)
        retiringAccessToken = container.sessionStore.current()?.accessToken
        // The server retires this installation while the credential is still valid.
        runCatching { retireLocked() }
        if (FirebaseApp.getApps(context).isNotEmpty()) {
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
            FirebaseMessaging.getInstance().deleteToken()
        }
        NotificationManagerCompat.from(context).cancelAll()
        registeredAccount = null; registeredToken = null
    }
}
