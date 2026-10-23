// Top-level build file where you can add configuration options common to all sub-projects/modules.

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
}

// Values read by autolinked libraries (safeExtGet / rootProject.ext). They must match
// app/build.gradle.kts; react-native-screens' CMake build rejects the minSdk 21 fallback.
extra["minSdkVersion"] = 26
extra["compileSdkVersion"] = 35
extra["targetSdkVersion"] = 35
// NDK already installed locally, used by libraries that compile C++ (react-native-screens).
extra["ndkVersion"] = "28.2.13676358"
