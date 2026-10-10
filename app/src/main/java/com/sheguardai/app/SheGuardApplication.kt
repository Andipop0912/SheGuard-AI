package com.sheguardai.app

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import com.sheguardai.app.activation.GesturePackage
import com.sheguardai.app.ask.AskVoicePackage
import com.sheguardai.app.config.AppConfigPackage
import com.sheguardai.app.di.AppContainer
import com.sheguardai.app.evidence.EvidencePackage
import com.sheguardai.app.location.LocationPackage
import com.sheguardai.app.routesafety.RouteSafetyGooglePackage
import com.sheguardai.app.security.SecureStoragePackage
import com.sheguardai.app.voice.VoicePackage

/**
 * Main application class for SheGuard AI.
 *
 * Implements ReactApplication host interface for React Native 0.76.5.
 * Registers native GesturePackage and VoicePackage alongside autolinked packages.
 */
class SheGuardApplication : Application(), ReactApplication {

    /**
     * Application-wide manual dependency container.
     */
    lateinit var container: AppContainer
        private set

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> {
                val packages = PackageList(this).packages.toMutableList()
                packages.add(GesturePackage())
                packages.add(VoicePackage())
                packages.add(LocationPackage())
                packages.add(SecureStoragePackage())
                packages.add(AppConfigPackage())
                packages.add(EvidencePackage())
                packages.add(RouteSafetyGooglePackage())
                packages.add(AskVoicePackage())
                return packages
            }

            override fun getJSMainModuleName(): String = "index"

            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        }

    override val reactHost: ReactHost
        get() = getDefaultReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        container = AppContainer()
        // RN 0.76 merges most native libraries into libreactnative.so; the mapping is required.
        SoLoader.init(this, OpenSourceMergedSoMapping)
    }
}
