package com.sheguardai.app.di

import com.sheguardai.app.activation.ActivationManager
import com.sheguardai.app.activation.ActivationManagerImpl

/**
 * Manual dependency container for application-scoped singletons.
 *
 * Designed to be lightweight for low-memory devices (~3 GB RAM).
 * Dependencies are instantiated lazily when first accessed.
 */
class AppContainer {

    /**
     * Preserved ActivationManager instance for safety activation state.
     */
    val activationManager: ActivationManager by lazy {
        ActivationManagerImpl()
    }
}
