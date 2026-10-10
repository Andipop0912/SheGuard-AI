package com.sheguardai.app.emergency.model

import com.sheguardai.app.di.AppContainer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class EmergencyModelTest {

    @Test
    fun `emergency event default values are correctly populated`() {
        val event = EmergencyEvent(
            eventId = "evt-123",
            userId = "user-456",
            deviceId = "dev-789",
            triggerSource = EmergencyTriggerSource.MANUAL_SOS
        )

        assertEquals("evt-123", event.eventId)
        assertEquals("user-456", event.userId)
        assertEquals("dev-789", event.deviceId)
        assertEquals(EmergencyTriggerSource.MANUAL_SOS, event.triggerSource)
        assertEquals(EmergencyState.TRIGGERED, event.state)
        assertEquals(SyncStatus.PENDING, event.syncStatus)
        assertNull(event.resolvedAt)
    }

    @Test
    fun `app container lazily initializes dependencies`() {
        val container = AppContainer()
        assertNotNull(container.activationManager)
    }
}
