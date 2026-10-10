package com.sheguardai.app.activation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ActivationViewModel(
    private val activationManager: ActivationManager,
    private val activationSource: ActivationSourceAdapter
) : ViewModel() {

    private val mutableLastResult =
        MutableStateFlow<ActivationResult?>(null)

    val activationState: StateFlow<ActivationState> =
        activationManager.activationState

    val activeSessionId: StateFlow<String?> =
        activationManager.activeSessionId

    val lastResult: StateFlow<ActivationResult?> =
        mutableLastResult.asStateFlow()

    private var activationObservationJob: Job? = null

    fun startActivationSource() {
        activationSource.startListening()

        activationObservationJob?.cancel()

        activationObservationJob = viewModelScope.launch {
            activationSource
                .observeRequests()
                .collect { request ->

                    val result =
                        activationManager.handleActivation(request)

                    mutableLastResult.value = result
                }
        }
    }

    fun stopActivationSource() {
        activationObservationJob?.cancel()
        activationObservationJob = null

        activationSource.stopListening()
    }

    fun stopProtection() {
        viewModelScope.launch {
            val result =
                activationManager.stopProtection()

            if (result.isFailure) {
                mutableLastResult.value =
                    ActivationResult.Failed(
                        code = "STOP_FAILED",
                        message =
                        result.exceptionOrNull()?.message
                            ?: "Unable to stop protection."
                    )
            }
        }
    }

    override fun onCleared() {
        stopActivationSource()
        super.onCleared()
    }
}