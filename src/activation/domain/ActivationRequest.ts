import { ActivationSource } from './ActivationSource';

/**
 * Domain model representing an activation request event.
 * Preserves Kotlin com.sheguardai.app.activation.ActivationRequest structure.
 */
export interface ActivationRequest {
  readonly requestId: string;
  readonly source: ActivationSource;
  readonly requestedAt: number;
  readonly userInitiated: boolean;
}
