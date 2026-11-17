export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface LlmRequest { model: string; messages: LlmMessage[]; temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number; signal?: AbortSignal }
export interface LlmResponse { text: string; model: string; ms: number; promptTokens?: number; completionTokens?: number }

export type LlmErrorKind = 'no_key' | 'auth' | 'rate_limit' | 'server' | 'timeout' | 'network' | 'model_not_found' | 'bad_request';
export class LlmError extends Error {
  constructor(public kind: LlmErrorKind, message: string, public status?: number, public retryAfterMs?: number) { super(message); this.name = 'LlmError'; }
}

export interface LlmProvider {
  id: 'groq' | 'gemini' | 'local';
  complete(req: LlmRequest): Promise<LlmResponse>;
  listModels(): Promise<string[]>;
  /** Speech-to-text for Whisper mode (Groq only). */
  transcribe?(audio: Blob, opts: { model: string; language?: string; prompt?: string }): Promise<string>;
}

export const PROVIDER_DEFAULTS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', planModel: 'openai/gpt-oss-120b', narrateModel: 'openai/gpt-oss-20b', fallbackModel: 'qwen/qwen3.8-27b', whisperModel: 'whisper-large-v3-turbo', keyUrl: 'https://console.groq.com/keys' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', planModel: 'gemini-flash-latest', narrateModel: 'gemini-flash-lite-latest', fallbackModel: 'gemini-flash-latest', whisperModel: '', keyUrl: 'https://aistudio.google.com/apikey' },
} as const;
