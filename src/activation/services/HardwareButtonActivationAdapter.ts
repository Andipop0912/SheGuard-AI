import { ActivationSourceAdapter } from '../domain/ActivationSourceAdapter';
import { ActivationRequest } from '../domain/ActivationRequest';

/**
 * Placeholder for future hardware-button integration.
 * Preserves Kotlin com.sheguardai.app.activation.HardwareButtonActivationAdapter.
 * Note: Android application limits physical hardware-button detection without native module hooks.
 */
export class HardwareButtonActivationAdapter implements ActivationSourceAdapter {
  public startListening(): void {
    // Future supported hardware integration goes here
  }

  public stopListening(): void {
    // Future cleanup goes here
  }

  public observeRequests(_listener: (request: ActivationRequest) => void): () => void {
    return () => {};
  }
}
