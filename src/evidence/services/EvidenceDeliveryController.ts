import { EmergencyCoordinator } from '../../emergency/services/EmergencyCoordinator';
import { EmergencyEvent } from '../../emergency/domain/EmergencyEvent';
import { isOpenEmergencyState } from '../../emergency/domain/EmergencyState';
import { EvidenceApiClient } from './EvidenceApiClient';

export const EVIDENCE_DELIVERY_TRIGGER_MS = 5 * 60 * 1000;

/**
 * Fires the five-minute evidence-delivery workflow: once an open emergency has been open for
 * five minutes, tells the backend to generate the incident report and send trusted contacts the
 * secure links (Part 14). Observes EmergencyCoordinator the same way every other controller
 * does; never creates, delays or cancels an emergency, and a delivery failure here never
 * surfaces into emergency handling. The server call is idempotent, so a duplicate trigger
 * (e.g. after an app restart close to the five-minute mark) is always a safe no-op.
 */
export class EvidenceDeliveryController {
  private unsubscribeCoordinator: (() => void) | null = null;
  private activeEventId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deliveredEventIds = new Set<string>();

  constructor(
    private readonly coordinator: EmergencyCoordinator,
    private readonly api: EvidenceApiClient
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
    this.clearTimer();
  }

  private async onEmergencyChanged(event: EmergencyEvent | null): Promise<void> {
    if (event && isOpenEmergencyState(event.state)) {
      if (this.activeEventId === event.eventId) return; // repeated notification
      this.activeEventId = event.eventId;
      this.scheduleDelivery(event);
      return;
    }

    if (this.activeEventId && (!event || event.eventId === this.activeEventId)) {
      this.activeEventId = null;
      this.clearTimer();
    }
  }

  private scheduleDelivery(event: EmergencyEvent): void {
    this.clearTimer();
    const elapsed = Date.now() - event.createdAt;
    const remaining = Math.max(0, EVIDENCE_DELIVERY_TRIGGER_MS - elapsed);
    const eventId = event.eventId;
    this.timer = setTimeout(() => {
      this.safely(() => this.deliver(eventId));
    }, remaining);
  }

  private async deliver(eventId: string): Promise<void> {
    if (this.activeEventId !== eventId || this.deliveredEventIds.has(eventId)) return;
    this.deliveredEventIds.add(eventId);
    await this.api.deliver(eventId);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private safely(work: () => Promise<void>): void {
    work().catch((e) => {
      console.warn('[EvidenceDeliveryController] delivery work failed', e);
    });
  }
}
