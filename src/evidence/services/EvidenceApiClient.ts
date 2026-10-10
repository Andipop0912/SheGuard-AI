import { ApiClient } from '../../api/ApiClient';

export interface EvidenceDeliveryResult {
  delivered: boolean;
  contactsNotified: number;
}

export interface IncidentReportResult {
  reportId: string;
  url: string | null;
}

/**
 * Backend-facing half of the evidence-delivery workflow, through the same authenticated
 * ApiClient every other server feature uses. A failure here never touches local recording,
 * the emergency path, or the evidence file already saved on the device.
 */
export class EvidenceApiClient {
  constructor(private readonly api: ApiClient) {}

  /** Idempotent server-side: a retried call is a safe no-op (contactsNotified: 0). */
  public async deliver(eventId: string): Promise<EvidenceDeliveryResult | null> {
    const result = await this.api.authorizedRequest<EvidenceDeliveryResult>({
      method: 'POST',
      path: `/evidence/${encodeURIComponent(eventId)}/deliver`,
    });
    return result.ok ? result.data : null;
  }

  /** Generates a fresh PDF incident report from current server-side data and uploads it. */
  public async generateReport(eventId: string): Promise<IncidentReportResult | null> {
    const result = await this.api.authorizedRequest<IncidentReportResult>({
      method: 'POST',
      path: `/evidence/${encodeURIComponent(eventId)}/report`,
    });
    return result.ok ? result.data : null;
  }

  /** A time-limited signed URL for a cloud-uploaded evidence item, or null if not uploaded yet. */
  public async getEvidenceDownloadUrl(evidenceId: string): Promise<string | null> {
    const result = await this.api.authorizedRequest<{ url: string }>({
      method: 'GET',
      path: `/evidence/${encodeURIComponent(evidenceId)}/download`,
    });
    return result.ok ? result.data.url : null;
  }
}
