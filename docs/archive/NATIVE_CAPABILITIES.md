# SheGuard AI — Android Native Capabilities & Technical Limitations

## Overview
SheGuard AI requires deep Android system integrations for reliable emergency activation. React Native JavaScript runtime alone cannot intercept physical hardware key combinations or run un-throttled background services without native Android wrappers.

---

## Technical Capability Analysis

| Capability | Requirement | Technical Mechanism | Android Limitation / Constraint | RN Status |
| :--- | :--- | :--- | :--- | :--- |
| **Hardware Button Detection** | Intercept physical volume/power key presses in background | Android `AccessibilityService` or `MediaButtonReceiver` | Android OS restricts 3rd-party apps from arbitrarily overriding power buttons for security. Requires explicit user-granted Accessibility permissions. | Abstraction Native Interface Provided (`src/native/HardwareButton.ts`) |
| **Background Service Execution** | Run persistent safety checks when app is closed | Android `ForegroundService` with `NOTIFICATION_TYPE_SPECIAL_USE` | Android 14+ (API 34/35) enforces strict foreground service type declarations and battery optimization whitelist (`Doze Mode`). | Abstraction Native Interface Provided (`src/native/BackgroundService.ts`) |
| **Gesture Activation** | Detect shake / double-tap motion gestures | Android `SensorEventListener` (`ACCELEROMETER`) | High-frequency sensor polling in background requires a low-power native service loop to prevent battery drain on ~3GB RAM target devices. | Adapter Interface Provided (`GestureActivationAdapter.ts`) |
| **Voice Activation** | Hotword detection ("Help SheGuard") | Native Speech Recognizer / PocketSphinx / ONNX runtime | Low-power offline voice trigger requires dedicated audio recording permission & foreground service. | Future Module Placeholder |
| **Offline Storage** | Durable emergency logging | SQLite / MMKV / AsyncStorage | File system access remains persistent; protected storage recommended. | Implemented via `EmergencyStorageRepository` |

---

## Native Bridge Architecture Rule
JavaScript timers (`setInterval` / `setTimeout`) must **NEVER** be used to fake native Android background services or hardware listeners. All physical device integrations must route through explicit TypeScript interface abstractions (`src/native/`) connected to native Java/Kotlin Android modules (`ReactContextBaseJavaModule`).
