import { ActivationManager } from '../../activation/domain/ActivationManager';
import { ActivationManagerImpl } from '../../activation/services/ActivationManagerImpl';
import { MockActivationSourceAdapter } from '../../activation/services/MockActivationSourceAdapter';
import { GestureActivationAdapter } from '../../activation/services/GestureActivationAdapter';
import { HardwareButtonActivationAdapter } from '../../activation/services/HardwareButtonActivationAdapter';
import { EmergencyStorageRepository } from '../../storage/EmergencyStorageRepository';
import { EmergencyCoordinator } from '../../emergency/services/EmergencyCoordinator';
import { VoiceActivationAdapter } from '../../voice/services/VoiceActivationAdapter';
import { locationPolicy } from '../../config/locationPolicy';
import { LocationNativeModule } from '../../location/native/LocationNativeBridge';
import { AndroidLocationPermissionGateway } from '../../location/native/locationPermissions';
import { LocationService } from '../../location/services/LocationService';
import { EmergencyLocationController } from '../../location/services/EmergencyLocationController';
import { EmergencyLocationRepository } from '../../location/storage/EmergencyLocationRepository';
import { LocationSyncQueue } from '../../location/sync/LocationSyncQueue';
import { DisconnectedLocationSyncTransport } from '../../location/sync/LocationSyncTransport';
import { HttpClient } from '../../api/HttpClient';
import { ApiClient } from '../../api/ApiClient';
import { API_TIMEOUT_MS, APP_VERSION, getApiBaseUrl } from '../../api/apiConfig';
import { AuthService } from '../../auth/services/AuthService';
import { createSecureStore } from '../../auth/storage/SecureStore';
import { EmergencySyncService } from '../../sync/EmergencySyncService';
import { ContactsRepository } from '../../contacts/services/ContactsRepository';
import { CommunicationStatusService } from '../../communication/services/CommunicationStatusService';
import { EvidenceController } from '../../evidence/services/EvidenceController';
import { EvidenceNativeModule } from '../../evidence/native/EvidenceNativeBridge';
import { EvidenceRepository } from '../../evidence/storage/EvidenceRepository';
import { EvidenceSyncQueue } from '../../evidence/sync/EvidenceSyncQueue';
import { DisconnectedEvidenceUploadTransport } from '../../evidence/sync/EvidenceUploadTransport';
import { EvidenceApiClient } from '../../evidence/services/EvidenceApiClient';
import { EvidenceDeliveryController } from '../../evidence/services/EvidenceDeliveryController';
import { RouteSafetyController } from '../../routesafety/services/RouteSafetyController';
import { RouteSafetyApiClient } from '../../routesafety/services/RouteSafetyApiClient';
import { RouteSafetyRepository } from '../../routesafety/storage/RouteSafetyRepository';
import { RouteSafetyGoogleService } from '../../routesafety/native/RouteSafetyGoogleBridge';
import { SafeLocationsService } from '../../routesafety/services/SafeLocationsService';
import { loadInstallDeviceId, setSignedInUser } from '../identity';

/**
 * Singleton service locator / dependency container for SheGuard AI.
 * Preserves Kotlin com.sheguardai.app.di.AppContainer.
 */
export class AppContainer {
  private static instance: AppContainer | null = null;

  public readonly activationManager: ActivationManager;
  public readonly mockActivationSource: MockActivationSourceAdapter;
  public readonly gestureActivationSource: GestureActivationAdapter;
  public readonly hardwareButtonActivationSource: HardwareButtonActivationAdapter;
  public readonly emergencyRepository: EmergencyStorageRepository;
  public readonly emergencyCoordinator: EmergencyCoordinator;
  public readonly voiceActivationAdapter: VoiceActivationAdapter;
  public readonly locationService: LocationService;
  public readonly emergencyLocationRepository: EmergencyLocationRepository;
  public readonly locationSyncQueue: LocationSyncQueue;
  public readonly emergencyLocationController: EmergencyLocationController;
  public readonly httpClient: HttpClient;
  public readonly authService: AuthService;
  public readonly apiClient: ApiClient;
  public readonly emergencySyncService: EmergencySyncService;
  public readonly contactsRepository: ContactsRepository;
  public readonly communicationStatusService: CommunicationStatusService;
  public readonly evidenceController: EvidenceController;
  public readonly evidenceRepository: EvidenceRepository;
  public readonly evidenceSyncQueue: EvidenceSyncQueue;
  public readonly evidenceApiClient: EvidenceApiClient;
  public readonly evidenceDeliveryController: EvidenceDeliveryController;
  public readonly routeSafetyController: RouteSafetyController;
  public readonly routeSafetyGoogleService: RouteSafetyGoogleService;
  public readonly safeLocationsService: SafeLocationsService;

  private constructor() {
    this.activationManager = new ActivationManagerImpl();
    this.mockActivationSource = new MockActivationSourceAdapter();
    this.gestureActivationSource = new GestureActivationAdapter(
      () => this.activationManager,
      () => this.emergencyCoordinator
    );
    this.hardwareButtonActivationSource = new HardwareButtonActivationAdapter();
    this.emergencyRepository = new EmergencyStorageRepository();
    this.emergencyCoordinator = new EmergencyCoordinator(this.emergencyRepository);
    this.voiceActivationAdapter = new VoiceActivationAdapter(this.emergencyCoordinator);

    // Location: observes the emergency lifecycle; never drives it.
    this.locationService = new LocationService(
      new LocationNativeModule(),
      new AndroidLocationPermissionGateway(),
      locationPolicy
    );
    this.emergencyLocationRepository = new EmergencyLocationRepository(locationPolicy.maxPointsPerEmergency);
    // Starts disconnected; startServerSync() swaps in the HTTP transport while signed in.
    this.locationSyncQueue = new LocationSyncQueue(
      this.emergencyLocationRepository,
      new DisconnectedLocationSyncTransport(),
      locationPolicy
    );
    this.emergencyLocationController = new EmergencyLocationController(
      this.emergencyCoordinator,
      this.locationService,
      this.emergencyLocationRepository,
      this.locationSyncQueue
    );

    // Server connection: observes the safety core; never part of the emergency trigger path.
    this.httpClient = new HttpClient(getApiBaseUrl, API_TIMEOUT_MS);
    this.authService = new AuthService({
      http: this.httpClient,
      secureStore: createSecureStore(),
      getDeviceId: loadInstallDeviceId,
      onSignedInUserChanged: setSignedInUser,
      appVersion: APP_VERSION,
    });
    this.apiClient = new ApiClient(this.httpClient, this.authService);
    this.emergencySyncService = new EmergencySyncService(
      this.emergencyRepository,
      this.emergencyCoordinator,
      this.apiClient,
      this.authService
    );

    // Trusted contacts and alert status: server-owned, managed/read through the same ApiClient.
    // Neither is ever used by the emergency trigger path.
    this.contactsRepository = new ContactsRepository(this.apiClient);
    this.communicationStatusService = new CommunicationStatusService(this.apiClient);

    // Evidence: observes the emergency lifecycle, same as location; never part of the trigger path.
    this.evidenceRepository = new EvidenceRepository();
    // Starts disconnected; startServerSync() swaps in the HTTP transport while signed in.
    this.evidenceSyncQueue = new EvidenceSyncQueue(this.evidenceRepository, new DisconnectedEvidenceUploadTransport());
    this.evidenceController = new EvidenceController(
      this.emergencyCoordinator,
      this.voiceActivationAdapter,
      new EvidenceNativeModule(),
      this.evidenceRepository,
      () => {
        this.evidenceSyncQueue.flush().catch(() => undefined);
      }
    );
    this.evidenceApiClient = new EvidenceApiClient(this.apiClient);
    this.evidenceDeliveryController = new EvidenceDeliveryController(this.emergencyCoordinator, this.evidenceApiClient);

    // Route Safety: reuses the same LocationService tracking toggle and the same ApiClient;
    // never a second GPS watcher, never a second communication system.
    this.routeSafetyController = new RouteSafetyController(
      this.emergencyCoordinator,
      this.locationService,
      new RouteSafetyRepository(),
      new RouteSafetyApiClient(this.apiClient)
    );
    this.routeSafetyGoogleService = new RouteSafetyGoogleService();
    this.safeLocationsService = new SafeLocationsService(this.routeSafetyGoogleService);
  }

  public static getInstance(): AppContainer {
    if (!AppContainer.instance) {
      AppContainer.instance = new AppContainer();
    }
    return AppContainer.instance;
  }

  public static resetForTesting(): void {
    AppContainer.instance?.emergencySyncService.dispose();
    AppContainer.instance?.communicationStatusService.stop();
    AppContainer.instance = null;
  }
}
