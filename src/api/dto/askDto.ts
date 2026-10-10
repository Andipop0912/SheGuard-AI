/** Wire format matching backend/app/schemas/ask.py */

export interface ChatMessageDto {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskRequestDto {
  messages: ChatMessageDto[];
}

export interface AskResponseDto {
  reply: string;
}

export function isAskResponse(value: unknown): value is AskResponseDto {
  const v = value as Partial<AskResponseDto> | null;
  return !!v && typeof v.reply === 'string' && v.reply.length > 0;
}

