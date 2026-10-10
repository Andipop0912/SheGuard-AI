/**
 * Event contract payload emitted when local Voice Keyword Detection identifies emergency hotword.
 * Preserves locked Voice V1 event schema.
 */
export interface VoiceTriggerPayload {
  readonly triggerId: string;
  readonly source: 'VOICE';
  readonly timestamp: number;
  readonly keywordDetected: string;
  readonly confidence: number;
  readonly detectorSessionId: string;

  readonly metadata: {
    readonly modelVersion: string;
    readonly isBackground: boolean;
    readonly batteryLevel?: number;
  };
}
