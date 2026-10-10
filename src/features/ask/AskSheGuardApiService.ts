/**
 * AskSheGuardApiService
 *
 * Sends the local conversation history to the backend Ask SheGuard endpoint.
 * The backend proxies to Gemini — the API key is NEVER in this file or any RN code.
 *
 * POST /api/v1/ask   (requires Bearer token)
 */
import { ApiClient } from '../../api/ApiClient';
import { AskRequestDto, AskResponseDto, isAskResponse } from '../../api/dto/askDto';
import type { ChatMessageDto } from '../../api/dto/askDto';

export type { ChatMessageDto };

export type AskApiResult =
  | { ok: true; reply: string }
  | { ok: false; kind: 'NOT_CONFIGURED' | 'SIGNED_OUT' | 'NETWORK' | 'TIMEOUT' | 'SERVER' | 'OFFLINE'; message: string };

export class AskSheGuardApiService {
  constructor(private readonly api: ApiClient) {}

  async ask(messages: ChatMessageDto[]): Promise<AskApiResult> {
    if (!this.api.isConfigured()) {
      return { ok: false, kind: 'NOT_CONFIGURED', message: 'Server not configured.' };
    }

    const body: AskRequestDto = { messages };
    const result = await this.api.authorizedRequest<AskResponseDto>({
      method: 'POST',
      path: '/ask',
      body,
      timeoutMs: 20_000, // AI responses can take a moment
    });

    if (!result.ok) {
      const { error } = result;
      switch (error.kind) {
        case 'NOT_CONFIGURED':
          return { ok: false, kind: 'NOT_CONFIGURED', message: 'Server not configured.' };
        case 'SIGNED_OUT':
          return { ok: false, kind: 'SIGNED_OUT', message: 'Sign in to use Ask SheGuard.' };
        case 'TIMEOUT':
          return { ok: false, kind: 'TIMEOUT', message: 'Request timed out. Please try again.' };
        case 'NETWORK':
          return { ok: false, kind: 'NETWORK', message: 'Ask SheGuard needs an internet connection for AI responses.' };
        case 'HTTP':
          return {
            ok: false,
            kind: 'SERVER',
            message: error.detail ?? 'AI assistant is temporarily unavailable. Please try again.',
          };
        default:
          return { ok: false, kind: 'SERVER', message: 'Unexpected error. Please try again.' };
      }
    }

    if (!isAskResponse(result.data)) {
      return { ok: false, kind: 'SERVER', message: 'Invalid response from AI assistant.' };
    }

    return { ok: true, reply: result.data.reply };
  }
}
