pluginManagement {
    includeBuild("node_modules/@react-native/gradle-plugin")

    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }

        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("com.facebook.react.settings")
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.10.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)

    repositories {
        google()
        mavenCentral()
    }
}

val configure = extensions.configure<com.facebook.react.ReactSettingsExtension> {
    val rnRoot = rootDir

    autolinkLibrariesFromCommand(
        workingDirectory = rnRoot,
        lockFiles = files(
            rnRoot.resolve("package.json"),
            rnRoot.resolve("package-lock.json"),
            rnRoot.resolve("react-native.config.js")
        )
    )
}

rootProject.name = "SheGuard AI"

include(":app")