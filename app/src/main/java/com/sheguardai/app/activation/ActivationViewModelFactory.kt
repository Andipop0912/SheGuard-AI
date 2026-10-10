package com.sheguardai.app.activation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider

class ActivationViewModelFactory(
    private val activationManager: ActivationManager,
    private val activationSource: ActivationSourceAdapter
) : ViewModelProvider.Factory {

    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(
        modelClass: Class<T>
    ): T {

        if (
            modelClass.isAssignableFrom(
                ActivationViewModel::class.java
            )
        ) {
            return ActivationViewModel(
                activationManager = activationManager,
                activationSource = activationSource
            ) as T
        }

        throw IllegalArgumentException(
            "Unknown ViewModel class: ${modelClass.name}"
        )
    }
}