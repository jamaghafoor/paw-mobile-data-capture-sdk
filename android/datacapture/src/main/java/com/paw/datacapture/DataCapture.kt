package com.paw.datacapture

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.CancellationSignal
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.HttpsURLConnection
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Host owns permission UI and authenticated access tokens. No persistent storage or background work. */
class DataCapture(
    context: Context,
    baseUrl: String,
    private val accessToken: suspend () -> String,
    allowedPackages: Set<String> = emptySet(),
) {
    private val context = context.applicationContext
    private val baseUrl = baseUrl.trimEnd('/')
    private val allowedPackages = allowedPackages.toSet()
    private val generation = AtomicLong()
    private val requests = ConcurrentHashMap.newKeySet<Job>()
    @Volatile private var consent: Consent? = null
    init {
        val url = URL(baseUrl)
        require(url.protocol == "https" && url.host.isNotBlank() && url.userInfo == null && url.query == null && url.ref == null) { "https_endpoint_required" }
        require(this.allowedPackages.size <= 50 && this.allowedPackages.all { Regex("[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z0-9_]+)+").matches(it) }) { "invalid_package_allowlist" }
    }
    @Synchronized fun grantConsent(value: Consent) {
        if (!value.personalData || value.noticeVersion.isBlank()) throw CaptureException("consent_required")
        withdrawConsent(); consent = value
    }
    @Synchronized fun withdrawConsent() {
        consent = null; generation.incrementAndGet()
        requests.forEach { it.cancel() }; requests.clear()
    }
    private fun requireConsent(): Consent = consent?.takeIf { it.personalData } ?: throw CaptureException("consent_required")
    private suspend fun <T> operation(block: suspend (Long) -> T): T = coroutineScope {
        val epoch: Long
        val job = currentCoroutineContext().job
        synchronized(this@DataCapture) { requireConsent(); epoch = generation.get(); requests.add(job) }
        try {
            val result = block(epoch)
            if (epoch != generation.get()) throw CaptureException("cancelled")
            result
        } finally { requests.remove(job) }
    }
    suspend fun startPhoneVerification(phone: String): PhoneChallenge {
        val result = post("phone/start", JSONObject().put("phone", Validation.phone(phone)).put("consent", consentJson(requireConsent())))
        return PhoneChallenge(result.getString("challengeId"), result.getLong("expiresAt"))
    }
    suspend fun verifyPhone(challengeId: String, code: String): PhoneVerification {
        if (!Regex("[0-9]{6}").matches(code)) throw CaptureException("invalid_code")
        val result = post("phone/verify", JSONObject().put("challengeId", challengeId).put("code", code))
        return PhoneVerification(result.getString("verificationId"), result.getLong("expiresAt"))
    }
    /** Call only from a resumed Activity, after the host requests FINE + COARSE runtime permissions. */
    suspend fun captureLocation(activity: Activity): LocationSample = operation {
        if (!requireConsent().location) throw CaptureException("location_consent_required")
        withContext(Dispatchers.Main.immediate) {
            if (activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) throw CaptureException("foreground_required")
            if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) throw CaptureException("precise_location_not_authorized")
            val manager = context.getSystemService(LocationManager::class.java)
            if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) throw CaptureException("location_unavailable")
            withTimeout(20_000) {
                suspendCancellableCoroutine { continuation ->
                    val signal = CancellationSignal()
                    continuation.invokeOnCancellation { signal.cancel() }
                    try {
                        manager.getCurrentLocation(LocationManager.GPS_PROVIDER, signal, context.mainExecutor) { location ->
                            if (continuation.isActive) {
                                try {
                                    if (activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) throw CaptureException("foreground_required")
                                    if (location == null || !location.hasAccuracy()) throw CaptureException("location_unavailable")
                                    continuation.resume(LocationSample(location.latitude, location.longitude, location.accuracy.toDouble(), location.time).validated())
                                } catch (error: Exception) { continuation.resumeWithException(error) }
                            }
                        }
                    } catch (_: SecurityException) { continuation.resumeWithException(CaptureException("location_denied")) }
                }
            }
        }
    }
    /** Partial visibility only. Missing packages may be absent OR invisible to this host. */
    @Synchronized fun installedApplications(): ApplicationsReport {
        val consent = requireConsent()
        if (!consent.applications) return ApplicationsReport("not_requested", emptyList(), "no_consent")
        val visible = allowedPackages.filter { name ->
            try { @Suppress("DEPRECATION") context.packageManager.getPackageInfo(name, 0); true }
            catch (_: PackageManager.NameNotFoundException) { false }
        }.sorted()
        return ApplicationsReport("limited", visible, "allowlisted_visible_packages_only")
    }
    suspend fun submit(fullName: String, phone: String, verificationId: String, carrier: String = "", location: LocationSample? = null, idempotencyKey: String): CaptureReceipt {
        val consent = requireConsent()
        if (location != null && !consent.location) throw CaptureException("location_consent_required")
        if (!Regex("[A-Za-z0-9_-]{16,100}").matches(idempotencyKey)) throw CaptureException("invalid_request_id")
        val apps = installedApplications()
        val body = JSONObject().put("fullName", Validation.name(fullName)).put("phone", Validation.phone(phone))
            .put("verificationId", verificationId).put("carrier", Validation.carrier(carrier)).put("consent", consentJson(consent)).put("idempotencyKey", idempotencyKey)
            .put("applications", JSONObject().put("status", apps.status).put("packages", JSONArray(apps.packages)).put("reason", apps.reason))
        location?.validated()?.let { body.put("location", JSONObject().put("latitude", it.latitude).put("longitude", it.longitude).put("accuracyMeters", it.accuracyMeters).put("timestamp", it.timestamp)) }
        val result = post("captures", body)
        return CaptureReceipt(result.getString("captureId"), result.getLong("receivedAt"))
    }
    private fun consentJson(value: Consent) = JSONObject().put("personalData", value.personalData).put("location", value.location).put("applications", value.applications).put("noticeVersion", value.noticeVersion).put("capturedAt", value.capturedAt)

    private suspend fun post(path: String, body: JSONObject): JSONObject = operation { epoch ->
        val token = accessToken()
        currentCoroutineContext().ensureActive()
        if (epoch != generation.get()) throw CaptureException("cancelled")
        if (token.isBlank() || token.contains('\r') || token.contains('\n')) throw CaptureException("authentication_required")
        withContext(Dispatchers.IO) {
            val connection = URL("$baseUrl/$path").openConnection() as HttpsURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000; connection.readTimeout = 15_000
            connection.requestMethod = "POST"; connection.doOutput = true; connection.useCaches = false
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Cache-Control", "no-store")
            try {
                currentCoroutineContext().ensureActive()
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val bytes = stream?.use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(4096)
                    while (output.size() <= 65_536) {
                        currentCoroutineContext().ensureActive()
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                    }
                    output.toByteArray()
                } ?: byteArrayOf()
                if (bytes.size > 65_536) throw CaptureException("response_too_large")
                val result = if (bytes.isNotEmpty()) JSONObject(String(bytes, Charsets.UTF_8)) else JSONObject()
                if (status !in 200..299) throw CaptureException(result.optString("error", "request_failed"))
                result
            } finally { connection.disconnect() }
        }
    }
}
