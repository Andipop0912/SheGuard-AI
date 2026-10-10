# SheGuard AI Architecture Document

## System Overview
SheGuard AI follows a unidirectional, clean layer separation pattern:

```text
UI (HomeScreen / App.tsx)
        │
        ▼
State Layer (Zustand Stores: activationStore, emergencyStore)
        │
        ▼
Domain & Services (ActivationManagerImpl, EmergencyCoordinator)
        │
        ▼
Persistence & Native Bridge (EmergencyStorageRepository, NativeModules)
```

---

## 1. Activation Lifecycle State Machine
The core protection system relies on strict state machine invariants implemented in [`ActivationManagerImpl`](file:///c:/Users/ADNAN/OneDrive/Desktop/Mini%20Project/SheGuard%20AI/CodeBase/src/activation/services/ActivationManagerImpl.ts):

```text
               ┌─────────────┐
               │  INACTIVE   │
               └──────┬──────┘
                      │ (handleActivation request)
                      ▼
          ┌──────────────────────┐
          │ ACTIVATION_RECEIVED  │
          └───────────┬──────────┘
                      │
                      ▼
          ┌──────────────────────┐
          │ CHECKING_PERMISSIONS │
          └───────────┬──────────┘
                      │
                      ▼
          ┌──────────────────────┐
          │    READY_TO_START    │
          └───────────┬──────────┘
                      │
                      ▼
          ┌──────────────────────┐
          │       STARTING       │
          └───────────┬──────────┘
                      │ (Generate Session UUID)
                      ▼
               ┌─────────────┐
               │   ACTIVE    │
               └──────┬──────┘
                      │ (stopProtection)
                      ▼
               ┌─────────────┐
               │  STOPPING   │
               └──────┬──────┘
                      │
                      ▼
               ┌─────────────┐
               │  INACTIVE   │
               └─────────────┘
```

If `userInitiated === false`, the system immediately transitions to `ActivationState.ERROR` and returns a rejection.

---

## 2. Offline-First Emergency Pipeline
Emergency activation operates offline-first:

1. **Triggering**: `EmergencyCoordinator.triggerEmergency()` generates a local `EmergencyEvent` with `state = EmergencyState.TRIGGERED` and `syncStatus = SyncStatus.PENDING`.
2. **Local Persistence**: The event is immediately saved via `EmergencyStorageRepository` to ensure durability across process crashes or system reboots.
3. **State Transition**: The event state moves to `EmergencyState.RESPONDING`.
4. **Sync Queue**: If network connectivity is online, the coordinator updates `syncStatus` to `SyncStatus.SYNCED`. If offline, events remain in the pending queue and are flushed when network returns.

---

## 3. Dependency Injection
Dependencies are managed via [`AppContainer`](file:///c:/Users/ADNAN/OneDrive/Desktop/Mini%20Project/SheGuard%20AI/CodeBase/src/app/di/AppContainer.ts), a singleton service locator preserving Kotlin's application-scoped container design.
