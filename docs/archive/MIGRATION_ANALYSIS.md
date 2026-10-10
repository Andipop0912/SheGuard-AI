# SheGuard AI — Kotlin to React Native Migration Analysis

## Executive Summary
This document maps the architectural, domain, business logic, state management, UI, and test components of the original Kotlin SheGuard AI Android application to their target React Native + TypeScript implementations.

---

## Component Mapping Matrix

| Kotlin / Android Component | Location in Kotlin Codebase | React Native / TypeScript Equivalent | Location in React Native Codebase | Status |
| :--- | :--- | :--- | :--- | :--- |
| `ActivationState` | `com.sheguardai.app.activation.ActivationModels` | `ActivationState` enum/type | `src/activation/domain/ActivationState.ts` | Complete |
| `ActivationSource` | `com.sheguardai.app.activation.ActivationModels` | `ActivationSource` enum/type | `src/activation/domain/ActivationSource.ts` | Complete |
| `ActivationRequest` | `com.sheguardai.app.activation.ActivationModels` | `ActivationRequest` interface | `src/activation/domain/ActivationRequest.ts` | Complete |
| `ActivationResult` | `com.sheguardai.app.activation.ActivationModels` | `ActivationResult` union type | `src/activation/domain/ActivationResult.ts` | Complete |
| `ActivationManager` | `com.sheguardai.app.activation.ActivationManager` | `ActivationManager` interface | `src/activation/domain/ActivationManager.ts` | Complete |
| `ActivationManagerImpl` | `com.sheguardai.app.activation.ActivationManagerImpl` | `ActivationManagerImpl` class | `src/activation/services/ActivationManagerImpl.ts` | Complete |
| `ActivationSourceAdapter` | `com.sheguardai.app.activation.ActivationSourceAdapter` | `ActivationSourceAdapter` interface | `src/activation/domain/ActivationSourceAdapter.ts` | Complete |
| `MockActivationSourceAdapter` | `com.sheguardai.app.activation.MockActivationSourceAdapter` | `MockActivationSourceAdapter` class | `src/activation/services/MockActivationSourceAdapter.ts` | Complete |
| `GestureActivationAdapter` | `com.sheguardai.app.activation.GestureActivationAdapter` | `GestureActivationAdapter` class | `src/activation/services/GestureActivationAdapter.ts` | Complete |
| `HardwareButtonActivationAdapter` | `com.sheguardai.app.activation.HardwareButtonActivationAdapter` | `HardwareButtonActivationAdapter` class | `src/activation/services/HardwareButtonActivationAdapter.ts` | Complete |
| `EmergencyEvent` | `com.sheguardai.app.emergency.model.EmergencyEvent` | `EmergencyEvent` interface | `src/emergency/domain/EmergencyEvent.ts` | Complete |
| `EmergencyState` | `com.sheguardai.app.emergency.model.EmergencyState` | `EmergencyState` enum/type | `src/emergency/domain/EmergencyState.ts` | Complete |
| `EmergencyTriggerSource` | `com.sheguardai.app.emergency.model.EmergencyTriggerSource` | `EmergencyTriggerSource` enum/type | `src/emergency/domain/EmergencyTriggerSource.ts` | Complete |
| `SyncStatus` | `com.sheguardai.app.emergency.model.SyncStatus` | `SyncStatus` enum/type | `src/emergency/domain/SyncStatus.ts` | Complete |
| `AppContainer` | `com.sheguardai.app.di.AppContainer` | `AppContainer` service locator | `src/app/di/AppContainer.ts` | Complete |
| `ActivationViewModel` | `com.sheguardai.app.activation.ActivationViewModel` | `useActivationStore` (Zustand) | `src/activation/store/activationStore.ts` | Complete |
| N/A | New Service | `EmergencyCoordinator` class | `src/emergency/services/EmergencyCoordinator.ts` | Complete |
| N/A | Offline Storage | `EmergencyStorageRepository` (AsyncStorage/MMKV/SQLite abstraction) | `src/storage/EmergencyStorageRepository.ts` | Complete |
| `MainActivity` | `com.sheguardai.app.MainActivity` | `HomeScreen.tsx` + `App.tsx` | `src/screens/HomeScreen.tsx` | Complete |
| Unit Tests | `ActivationManagerTest.kt`, `MockActivationSourceAdapterTest.kt`, `EmergencyModelTest.kt` | Jest test suites | `__tests__/` | Complete |

---

## State Machine Invariants & Security Rules
1. **User Initiation Constraint**: `handleActivation()` rejects any request where `userInitiated === false` and transitions state to `ERROR`.
2. **Duplicate Protection Prevention**: Requests issued when `activationState === 'ACTIVE'` are rejected with `ActivationResult.Rejected("Protection session is already active.")`.
3. **Session UUID Lifecyle**: Starting protection generates a new `UUID.v4()`. Stopping protection or resetting clears `activeSessionId` to `null`.
4. **Offline Emergency Integrity**: `EmergencyEvent` is immediately recorded locally with `syncStatus = SyncStatus.PENDING` when triggered, allowing eventual backend sync without blocking safety operations.
