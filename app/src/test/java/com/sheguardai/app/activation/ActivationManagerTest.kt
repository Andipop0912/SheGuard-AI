package com.sheguardai.app.activation

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ActivationManagerTest {

    private lateinit var manager: ActivationManagerImpl

    @Before
    fun setup() {
        manager = ActivationManagerImpl()
    }

    @Test
    fun `initial state is inactive`() {

        assertEquals(
            ActivationState.INACTIVE,
            manager.activationState.value
        )

        assertEquals(
            null,
            manager.activeSessionId.value
        )
    }

    @Test
    fun `user initiated activation starts protection`() =
        runBlocking {

            val request = ActivationRequest(
                requestId = "request-1",
                source = ActivationSource.MOCK,
                requestedAt = 100L,
                userInitiated = true
            )

            val result =
                manager.handleActivation(request)

            assertTrue(
                result is ActivationResult.Started
            )

            assertEquals(
                ActivationState.ACTIVE,
                manager.activationState.value
            )

            assertNotNull(
                manager.activeSessionId.value
            )
        }

    @Test
    fun `non user initiated activation is rejected`() =
        runBlocking {

            val request = ActivationRequest(
                requestId = "request-2",
                source = ActivationSource.MOCK,
                requestedAt = 100L,
                userInitiated = false
            )

            val result =
                manager.handleActivation(request)

            assertTrue(
                result is ActivationResult.Rejected
            )

            assertEquals(
                ActivationState.ERROR,
                manager.activationState.value
            )
        }

    @Test
    fun `duplicate activation is rejected while active`() =
        runBlocking {

            val firstRequest = ActivationRequest(
                requestId = "request-1",
                source = ActivationSource.MOCK,
                requestedAt = 100L,
                userInitiated = true
            )

            val secondRequest = ActivationRequest(
                requestId = "request-2",
                source = ActivationSource.MOCK,
                requestedAt = 200L,
                userInitiated = true
            )

            manager.handleActivation(firstRequest)

            val result =
                manager.handleActivation(secondRequest)

            assertTrue(
                result is ActivationResult.Rejected
            )

            assertEquals(
                ActivationState.ACTIVE,
                manager.activationState.value
            )
        }

    @Test
    fun `stop protection returns to inactive`() =
        runBlocking {

            val request = ActivationRequest(
                requestId = "request-1",
                source = ActivationSource.MOCK,
                requestedAt = 100L,
                userInitiated = true
            )

            manager.handleActivation(request)

            val result =
                manager.stopProtection()

            assertTrue(
                result.isSuccess
            )

            assertEquals(
                ActivationState.INACTIVE,
                manager.activationState.value
            )

            assertEquals(
                null,
                manager.activeSessionId.value
            )
        }

    @Test
    fun `stopping without active session fails`() =
        runBlocking {

            val result =
                manager.stopProtection()

            assertTrue(
                result.isFailure
            )

            assertEquals(
                ActivationState.INACTIVE,
                manager.activationState.value
            )
        }

    @Test
    fun `reset to inactive clears active session`() =
        runBlocking {

            val request = ActivationRequest(
                requestId = "request-1",
                source = ActivationSource.MOCK,
                requestedAt = 100L,
                userInitiated = true
            )

            manager.handleActivation(request)

            assertEquals(
                ActivationState.ACTIVE,
                manager.activationState.value
            )

            manager.resetToInactive()

            assertEquals(
                ActivationState.INACTIVE,
                manager.activationState.value
            )

            assertEquals(
                null,
                manager.activeSessionId.value
            )
        }
}