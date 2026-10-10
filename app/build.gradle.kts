import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
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
        compose = true
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
    // Activity + Jetpack Compose
    // =========================================

    implementation(libs.androidx.activity.compose)

    implementation(
        platform(libs.androidx.compose.bom)
    )

    implementation(libs.androidx.ui)

    implementation(libs.androidx.ui.graphics)

    implementation(
        libs.androidx.ui.tooling.preview
    )

    implementation(libs.androidx.material3)


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

    androidTestImplementation(
        platform(libs.androidx.compose.bom)
    )

    androidTestImplementation(
        libs.androidx.ui.test.junit4
    )


    // =========================================
    // Debug / Compose Testing
    // =========================================

    debugImplementation(
        libs.androidx.ui.tooling
    )

    debugImplementation(
        libs.androidx.ui.test.manifest
    )
}