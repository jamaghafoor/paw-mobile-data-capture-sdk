package com.paw.datacapture

import org.junit.Assert.*
import org.junit.Test

class ValidationTest {
    @Test fun acceptsInternationalNamesAndPhones() {
        assertEquals("李", Validation.name(" 李 "))
        assertEquals("محمد علي", Validation.name(" محمد   علي "))
        assertEquals("+923001234567", Validation.phone("+92 (300) 123-4567"))
    }
    @Test fun rejectsInvalidPersonalData() {
        assertThrows(CaptureException::class.java) { Validation.phone("03001234567") }
        assertThrows(CaptureException::class.java) { Validation.name("<script>") }
        assertThrows(CaptureException::class.java) { Validation.name("a\u202Eb") }
    }
    @Test fun rejectsStaleOrImpreciseLocation() {
        val now = System.currentTimeMillis()
        assertEquals(0.0, LocationSample(0.0, 0.0, 20.0, now).validated(now).latitude, 0.0)
        assertThrows(CaptureException::class.java) { LocationSample(Double.NaN, 0.0, 20.0, now).validated(now) }
        assertThrows(CaptureException::class.java) { LocationSample(0.0, 0.0, 101.0, now).validated(now) }
        assertThrows(CaptureException::class.java) { LocationSample(0.0, 0.0, 20.0, now - 60_001).validated(now) }
    }
}
