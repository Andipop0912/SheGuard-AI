# SheGuard AI — React Native (Mobile Safety Application)

## Overview
SheGuard AI is a lightweight personal safety mobile application designed to provide rapid emergency activation, state flow management, and offline-first emergency event logging. This project is a React Native + TypeScript reimplementation of the original Kotlin + Jetpack Compose Android codebase.

---

## Key Features & Architecture
- **State Machine Protection Lifecycle**: Strict state flow transition validation (`INACTIVE` -> `ACTIVATION_RECEIVED` -> `CHECKING_PERMISSIONS` -> `READY_TO_START` -> `STARTING` -> `ACTIVE` -> `STOPPING` / `ERROR`).
- **User Initiation Enforcement**: Security rule ensuring non-user-initiated activation attempts are rejected with `ActivationState.ERROR`.
- **Session Management**: Dynamic UUID generation for every active protection session.
- **Offline-First Emergency Handling**: Local persistence of emergency events (`SyncStatus.PENDING`), enabling background synchronization when network connectivity becomes available.
- **State Management**: **Zustand** stores decoupled from business services.

---

## Directory Structure
```text
SheGuardAI/
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   └── di/
│   │       └── AppContainer.ts
│   ├── activation/
│   │   ├── domain/
│   │   │   ├── ActivationManager.ts
│   │   │   ├── ActivationRequest.ts
│   │   │   ├── ActivationResult.ts
│   │   │   ├── ActivationSource.ts
│   │   │   ├── ActivationSourceAdapter.ts
│   │   │   └── ActivationState.ts
│   │   ├── services/
│   │   │   ├── ActivationManagerImpl.ts
│   │   │   ├── GestureActivationAdapter.ts
│   │   │   ├── HardwareButtonActivationAdapter.ts
│   │   │   └── MockActivationSourceAdapter.ts
│   │   └── store/
│   │       └── activationStore.ts
│   ├── emergency/
│   │   ├── domain/
│   │   │   ├── EmergencyEvent.ts
│   │   │   ├── EmergencyState.ts
│   │   │   ├── EmergencyTriggerSource.ts
│   │   │   └── SyncStatus.ts
│   │   ├── services/
│   │   │   └── EmergencyCoordinator.ts
│   │   └── store/
│   │       └── emergencyStore.ts
│   ├── native/
│   │   ├── BackgroundService.ts
│   │   └── HardwareButton.ts
│   ├── screens/
│   │   └── HomeScreen.tsx
│   └── storage/
│       └── EmergencyStorageRepository.ts
├── __tests__/
├── package.json
├── tsconfig.json
├── MIGRATION_ANALYSIS.md
├── ARCHITECTURE.md
├── NATIVE_CAPABILITIES.md
└── MIGRATION_STATUS.md
```

---

## Setup & Running Instructions

### Prerequisites
- Node.js >= 18
- React Native CLI
- Android Studio & SDK (for Android build)

### Running Tests
```bash
npm test
```

### Running on Android
```bash
npm run android
```
