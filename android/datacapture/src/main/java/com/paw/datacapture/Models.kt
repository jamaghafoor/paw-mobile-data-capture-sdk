package com.paw.datacapture

import java.text.Normalizer

class CaptureException(val code: String) : Exception(code)

data class Consent(
    val personalData: Boolean,
    val location: Boolean,
    val applications: Boolean,
    val noticeVersion: String,
    val capturedAt: Long = System.currentTimeMillis(),
)
data class LocationSample(val latitude: Double, val longitude: Double, val accuracyMeters: Double, val timestamp: Long) {
    fun validated(now: Long = System.currentTimeMillis(), maxAccuracyMeters: Double = 100.0): LocationSample {
        if (!latitude.isFinite() || latitude !in -90.0..90.0 || !longitude.isFinite() || longitude !in -180.0..180.0 || !accuracyMeters.isFinite() || accuracyMeters < 0) throw CaptureException("invalid_location")
        if (timestamp < now - 60_000 || timestamp > now + 5_000) throw CaptureException("stale_location")
        if (!maxAccuracyMeters.isFinite() || maxAccuracyMeters <= 0 || accuracyMeters > maxAccuracyMeters) throw CaptureException("imprecise_location")
        return this
    }
}
data class ApplicationsReport(val status: String, val packages: List<String>, val reason: String)
data class PhoneChallenge(val challengeId: String, val expiresAt: Long)
data class PhoneVerification(val verificationId: String, val expiresAt: Long)
data class CaptureReceipt(val captureId: String, val receivedAt: Long)

object Validation {
    fun name(value: String): String {
        val result = Normalizer.normalize(value, Normalizer.Form.NFC).trim().replace(Regex("(?U)\\s+"), " ")
        if (result.isEmpty() || result.length > 150 || !Regex("\\p{L}").containsMatchIn(result) || Regex("[\\p{Cc}\\p{Cf}<>]").containsMatchIn(result)) throw CaptureException("invalid_name")
        return result
    }
    fun phone(value: String): String {
        val result = value.trim().replace(Regex("[ ()-]"), "")
        if (!Regex("^\\+[1-9][0-9]{7,14}$").matches(result)) throw CaptureException("invalid_phone")
        return result
    }
    fun carrier(value: String): String {
        val result = value.trim()
        if (result.length > 100 || Regex("[\\p{Cc}\\p{Cf}<>]").containsMatchIn(result)) throw CaptureException("invalid_carrier")
        return result
    }
}
