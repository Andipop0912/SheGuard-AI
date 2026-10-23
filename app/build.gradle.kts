import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    id("com.facebook.react")
}

// react-native-vector-icons: bundle only MaterialIcons (the Flutter design uses Material icons).
// node_modules is one level above this module, not two as fonts.gradle assumes by default.
extra["vectoricons"] = mapOf(
    "iconFontsDir" to "../node_modules/react-native-vector-icons/Fonts",
    "iconFontNames" to listOf("MaterialIcons.ttf")
)
apply(from = file("../node_modules/react-native-vector-icons/fonts.gradle"))

react {
    val rnRoot = rootProject.layout.projectDirectory

    root.set(rnRoot)

    reactNativeDir.set(
        rnRoot.dir("node_modules/react-native")
    )

    codegenDir.set(
        rnRoot.dir("node_modules/@react-native/codegen")
    )

    cliFile.set(
        rnRoot.file("node_modules/react-native/cli.js")
    )

    // Adds the autolinked library projects (from settings.gradle.kts) as app dependencies,
    // so the generated PackageList.java can compile against them.
    autolinkLibrariesWithApp()
}

android {
    namespace = "com.sheguardai.app"
    compileSdk = 35

    // Google Maps SDK for Android key (Android-restricted: package name + SHA-1). Never committed:
    // read from local.properties (git-ignored) "MAPS_API_KEY", or the MAPS_API_KEY environment
    // variable. Without a key the app still builds and runs; the in-app map is simply not shown.
    val mapsApiKey: String = run {
        val props = Properties()
        val localProps = rootProject.file("local.properties")
        if (localProps.exists()) localProps.inputStream().use { props.load(it) }
        (props.getProperty("MAPS_API_KEY") ?: System.getenv("MAPS_API_KEY") ?: "").trim()
    }

    // Release signing: credentials come from env vars, or a local gitignored
    // app/signing.properties (see signing.properties.example) — never from source control.
    // Missing credentials fall back to debug signing (with a build warning) so local/CI
    // `assembleRelease` keeps working without a production keystore.
    val signingProps = Properties().apply {
        val propsFile = file("signing.properties")
        if (propsFile.exists()) propsFile.inputStream().use { load(it) }
    }
    fun signingValue(propKey: String, envKey: String): String? =
        signingProps.getProperty(propKey)?.takeIf { it.isNotBlank() }
            ?: System.getenv(envKey)?.takeIf { it.isNotBlank() }

    val releaseStoreFile = signingValue("storeFile", "SHEGUARD_RELEASE_STORE_FILE")
    val releaseStorePassword = signingValue("storePassword", "SHEGUARD_RELEASE_STORE_PASSWORD")
    val releaseKeyAlias = signingValue("keyAlias", "SHEGUARD_RELEASE_KEY_ALIAS")
    val releaseKeyPassword = signingValue("keyPassword", "SHEGUARD_RELEASE_KEY_PASSWORD")
    val hasReleaseSigningConfig = listOf(
        releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword
    ).all { !it.isNullOrBlank() }

    if (!hasReleaseSigningConfig) {
        logger.warn(
            "SheGuard: no release signing credentials found (signing.properties or " +
                "SHEGUARD_RELEASE_* env vars) — release build will fall back to debug signing."
        )
    }

    signingConfigs {
        if (hasReleaseSigningConfig) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    defaultConfig {
        applicationId = "com.sheguardai.app"
        minSdk = 26
        targetSdk = 35

        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner =
            "androidx.test.runner.AndroidJUnitRunner"

        manifestPlaceholders["googleMapsApiKey"] = mapsApiKey
        buildConfigField("boolean", "GOOGLE_MAPS_CONFIGURED", mapsApiKey.isNotEmpty().toString())
        // Native-only (never exposed to JS, same boundary as the Maps SDK key): used by the
        // Route Safety native module to call Google Routes API (New) and Places API (New)
        // server-side-equivalent REST calls with the Android-app-restricted key.
        buildConfigField("String", "GOOGLE_MAPS_API_KEY", "\"$mapsApiKey\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false

            signingConfig = if (hasReleaseSigningConfig) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }

            proguardFiles(
                getDefaultProguardFile(
                    "proguard-android-optimize.txt"
                ),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {

    // =========================================
    // React Native Android
    // =========================================

    implementation("com.facebook.react:react-android:0.76.5")

    // JS engine (version is pinned to react-native 0.76.5 by the React Gradle plugin).
    // Must match hermesEnabled in gradle.properties / BuildConfig.IS_HERMES_ENABLED.
    implementation("com.facebook.react:hermes-android")


    // =========================================
    // Android Core
    // =========================================

    implementation(libs.androidx.core.ktx)


    // =========================================
    // Lifecycle
    // =========================================

    implementation(
        libs.androidx.lifecycle.runtime.ktx
    )

    implementation(
        libs.androidx.lifecycle.viewmodel.ktx
    )


    // =========================================
    // Kotlin Coroutines
    // =========================================

    implementation(
        libs.kotlinx.coroutines.android
    )


    // =========================================
    // Offline Speech Recognition - Vosk
    // =========================================

    implementation(
        libs.vosk.android
    )


    // =========================================
    // Location (Fused provider; LocationManager fallback needs no dependency)
    // =========================================

    implementation(
        libs.play.services.location
    )


    // =========================================
    // Places SDK for Android (New) — Android-app-restricted key support for
    // Text Search / Nearby Search, unlike direct Places API (New) REST calls.
    // =========================================

    implementation(
        libs.places.android
    )


    // =========================================
    // Local Unit Tests
    // =========================================

    testImplementation(libs.junit)


    // =========================================
    // Android Instrumentation Tests
    // =========================================

    androidTestImplementation(
        libs.androidx.junit
    )

    androidTestImplementation(
        libs.androidx.espresso.core
    )
}