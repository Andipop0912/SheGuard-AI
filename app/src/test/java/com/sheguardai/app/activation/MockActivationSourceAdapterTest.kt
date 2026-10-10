package com.sheguardai.app.activation

import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MockActivationSourceAdapterTest {

    @Test
    fun `activation is rejected when source is not listening`() {

        val adapter =
            MockActivationSourceAdapter()

        val emitted =
            adapter.simulateActivation()

        assertFalse(emitted)
    }

    @Test
    fun `activation is emitted when source is listening`() =
        runBlocking {

            val adapter =
                MockActivationSourceAdapter()

            adapter.startListening()

            val requestDeferred = async {
                adapter
                    .observeRequests()
                    .first()
            }

            val emitted =
                adapter.simulateActivation()

            assertTrue(emitted)

            val request =
                requestDeferred.await()

            assertEquals(
                ActivationSource.MOCK,
                request.source
            )

            assertTrue(
                request.userInitiated
            )

            adapter.stopListening()
        }

    @Test
    fun `source stops emitting after listening is stopped`() {

        val adapter =
            MockActivationSourceAdapter()

        adapter.startListening()

        adapter.stopListening()

        val emitted =
            adapter.simulateActivation()

        assertFalse(emitted)
    }

    @Test
    fun `activation can be marked as not user initiated`() =
        runBlocking {

            val adapter =
                MockActivationSourceAdapter()

            adapter.startListening()

            val requestDeferred = async {
                adapter
                    .observeRequests()
                    .first()
            }

            val emitted =
                adapter.simulateActivation(
                    userInitiated = false
                )

            assertTrue(emitted)

            val request =
                requestDeferred.await()

            assertEquals(
                ActivationSource.MOCK,
                request.source
            )

            assertFalse(
                request.userInitiated
            )

            adapter.stopListening()
        }
}