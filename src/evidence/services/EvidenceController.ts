import { EmergencyCoordinator } from '../../emergency/services/EmergencyCoordinator';
import { EmergencyEvent } from '../../emergency/domain/EmergencyEvent';
import { isOpenEmergencyState } from '../../emergency/domain/EmergencyState';
import { VoiceActivationAdapter } from '../../voice/services/VoiceActivationAdapter';
import { EvidenceItem, EvidenceSyncStatus, EvidenceType } from '../domain/EvidenceItem';
import { EvidenceNativeInterface } from '../native/EvidenceNativeBridge';
import { ensureEvidencePermissions } from '../native/evidencePermissions';
import { EvidenceRepository } from '../storage/EvidenceRepository';

export const EVIDENCE_MAX_DURATION_MS = 5 * 60 * 1000;

export type EvidenceRecordingStatus = 'RECORDING' | 'SAVED' | 'UNAVAILABLE';

export interface EvidenceControllerState {
  eventId: string;
  status: EvidenceRecordingStatus;
  unavailableReason: string | null;
  /** Set only while status is RECORDING; when the native recorder actually started. */
  recordingStartedAt: number | null;
}

/**
 * Ties audio evidence capture to the existing emergency lifecycle, the same way
 * EmergencyLocationController ties in location capture: observes EmergencyCoordinator, starts
 * recording the instant an emergency opens (no network/GPS/SMS wait), stops it when the
 * emergency closes, and never creates, delays or cancels an emergency.
 *
 * Voice hotword detection and evidence recording are two exclusive microphone consumers, so
 * voice listening is paused for the duration of the recording and resumed afterwards (ONE
 * microphone owner at a time). A fixed maximum duration bounds the recording even if the
 * emergency stays open a long time.
 */
export class EvidenceController {
  private unsubscribeCoordinator: (() => void) | null = null;
  private activeEventId: string | null = null;
  private voiceWasActiveBeforeRecording = false;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private state: EvidenceControllerState | null = null;
  private readonly listeners = new Set<(state: EvidenceControllerState | null) => void>();

  constructor(
    private readonly coordinator: EmergencyCoordinator,
    private readonly voice: VoiceActivationAdapter,
    private readonly native: EvidenceNativeInterface,
    private readonly repository: EvidenceRepository,
    private readonly onItemSaved?: (item: EvidenceItem) => void
  ) {}

  /** Idempotent. */
  public start(): void {
    if (this.unsubscribeCoordinator) return;
    this.unsubscribeCoordinator = this.coordinator.subscribeActiveEvent((event) => {
      this.safely(() => this.onEmergencyChanged(event));
    });
  }

  public stop(): void {
    this.unsubscribeCoordinator?.();
    this.unsubscribeCoordinator = null;
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    this.maxDurationTimer = null;
  }

  public getState(): EvidenceControllerState | null {
    return this.state;
  }

  public subscribe(listener: (state: EvidenceControllerState | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public getItemsForEvent(eventId: string): Promise<EvidenceItem[]> {
    return this.repository.getForEvent(eventId);
  }

  private async onEmergencyChanged(event: EmergencyEvent | null): Promise<void> {
    if (event && isOpenEmergencyState(event.state)) {
      if (this.activeEventId === event.eventId) return; // repeated notification
      this.activeEventId = event.eventId;
      await this.beginRecording(event.eventId);
      return;
    }

    if (this.activeEventId && (!event || event.eventId === this.activeEventId)) {
      const endedEventId = this.activeEventId;
      this.activeEventId = null;
      await this.endRecording(endedEventId);
    }
  }

  private async beginRecording(eventId: string): Promise<void> {
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);

    if ((await ensureEvidencePermissions()) !== 'granted') {
      this.publish({ eventId, status: 'UNAVAILABLE', unavailableReason: 'Microphone permission denied', recordingStartedAt: null });
      return;
    }

    // Evidence recording and voice hotword detection cannot hold the microphone at the same
    // time; voice is ARM-independent and normally always running, so it is paused here and
    // resumed in endRecording(), regardless of which trigger source opened this emergency.
    this.voiceWasActiveBeforeRecording = this.voice.isVoiceMonitoringActive();
    if (this.voiceWasActiveBeforeRecording) {
      await this.voice.stopListening();
    }

    try {
      await this.native.startRecording(eventId);
      if (this.activeEventId !== eventId) {
        // Emergency already closed while permission/mic handoff was in flight.
        await this.endRecording(eventId);
        return;
      }
      this.publish({ eventId, status: 'RECORDING', unavailableReason: null, recordingStartedAt: Date.now() });
      this.maxDurationTimer = setTimeout(() => {
        this.safely(() => this.onEmergencyChanged(null));
      }, EVIDENCE_MAX_DURATION_MS);
    } catch (e) {
      if (this.voiceWasActiveBeforeRecording) await this.voice.startListening();
      this.publish({
        eventId,
        status: 'UNAVAILABLE',
        unavailableReason: e instanceof Error ? e.message : 'Audio evidence unavailable',
        recordingStartedAt: null,
      });
    }
  }

  private async endRecording(eventId: string): Promise<void> {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    if (this.state?.eventId === eventId && this.state.status === 'RECORDING') {
      try {
        const result = await this.native.stopRecording();
        const item: EvidenceItem = {
          evidenceId: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventId,
          type: EvidenceType.AUDIO,
          filePath: result.filePath,
          createdAt: Date.now(),
          durationMs: result.durationMs,
          syncStatus: EvidenceSyncStatus.LOCAL_ONLY,
        };
        await this.repository.save(item);
        this.publish({ eventId, status: 'SAVED', unavailableReason: null, recordingStartedAt: null });
        this.onItemSaved?.(item);
      } catch (e) {
        this.publish({
          eventId,
          status: 'UNAVAILABLE',
          unavailableReason: e instanceof Error ? e.message : 'Audio evidence unavailable',
          recordingStartedAt: null,
        });
      }
    }

    if (this.voiceWasActiveBeforeRecording) {
      this.voiceWasActiveBeforeRecording = false;
      await this.voice.startListening();
    }
  }

  private publish(state: EvidenceControllerState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }

  private safely(work: () => Promise<void>): void {
    work().catch((e) => {
      // Evidence problems must never surface into emergency handling.
      console.warn('[EvidenceController] evidence work failed', e);
    });
  }
}
