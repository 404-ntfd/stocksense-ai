// One provider class for every OpenAI-compatible endpoint (Groq, and Gemini's compatibility API).
// Bring-your-own-key: the key is read at call time from secure storage and is never logged.
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from '../types';

type FetchFn = typeof fetch;

export class OpenAiCompatProvider implements LlmProvider {
  constructor(public id: 'groq' | 'gemini', private baseUrl: string, private getKey: () => string | null | Promise<string | null>, private fetchFn: FetchFn = (...a) => fetch(...a)) {}

  private async key(): Promise<string> {
    const k = (await this.getKey())?.trim();
    if (!k) throw new LlmError('no_key', 'No API key is set.');
    return k;
  }

  private async request(path: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = (): void => ctl.abort();
    outer?.addEventListener('abort', onAbort);
    try {
      return await this.fetchFn(this.baseUrl + path, { ...init, signal: ctl.signal });
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') throw new LlmError(outer?.aborted ? 'network' : 'timeout', outer?.aborted ? 'Cancelled.' : 'The AI took too long to answer.');
      throw new LlmError('network', 'Could not reach the AI service. Check your internet connection.');
    } finally { clearTimeout(timer); outer?.removeEventListener('abort', onAbort); }
  }

  private async fail(res: Response): Promise<never> {
    let detail = '';
    try { const j = (await res.json()) as { error?: { message?: string; code?: string } }; detail = j?.error?.message ?? ''; } catch { /* body is not JSON */ }
    const ra = Number(res.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
    if (res.status === 401 || res.status === 403) throw new LlmError('auth', 'The API key was rejected. Check it in Settings.', res.status);
    if (res.status === 429) throw new LlmError('rate_limit', 'The AI service is busy (rate limit reached).', 429, retryAfterMs);
    if (res.status === 404 || /model.*(not found|does not exist|decommission)/i.test(detail)) throw new LlmError('model_not_found', `The AI model is not available: ${detail.slice(0, 120)}`, res.status);
    if (res.status >= 500) throw new LlmError('server', 'The AI service had a problem. Try again in a moment.', res.status, retryAfterMs);
    throw new LlmError('bad_request', detail.slice(0, 200) || `The AI service refused the request (${res.status}).`, res.status);
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const key = await this.key();
    const t0 = Date.now();
    const body: Record<string, unknown> = { model: req.model, messages: req.messages, temperature: req.temperature ?? 0 };
    if (this.id === 'groq') {
      body.max_completion_tokens = req.maxTokens ?? 800;
      if (/gpt-oss/.test(req.model)) { body.reasoning_effort = 'low'; body.include_reasoning = false; }
    } else body.max_tokens = req.maxTokens ?? 800;
    if (req.json) body.response_format = { type: 'json_object' };
    const res = await this.request('/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, req.timeoutMs ?? 20000, req.signal);
    if (!res.ok) await this.fail(res);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = j.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new LlmError('server', 'The AI returned an empty answer.');
    return { text, model: j.model ?? req.model, ms: Date.now() - t0, promptTokens: j.usage?.prompt_tokens, completionTokens: j.usage?.completion_tokens };
  }

  async listModels(): Promise<string[]> {
    const key = await this.key();
    const res = await this.request('/models', { headers: { Authorization: `Bearer ${key}` } }, 15000);
    if (!res.ok) await this.fail(res);
    const j = (await res.json()) as { data?: Array<{ id: string }> };
    return (j.data ?? []).map((m) => m.id.replace(/^models\//, '')).sort();
  }

  async transcribe(audio: Blob, opts: { model: string; language?: string; prompt?: string }): Promise<string> {
    const key = await this.key();
    const form = new FormData();
    const ext = /mp4|m4a|aac/.test(audio.type) ? 'm4a' : /ogg/.test(audio.type) ? 'ogg' : /wav/.test(audio.type) ? 'wav' : 'webm';
    form.append('file', audio, `speech.${ext}`);
    form.append('model', opts.model);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (opts.language) form.append('language', opts.language);
    if (opts.prompt) form.append('prompt', opts.prompt.slice(0, 800));
    const res = await this.request('/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form }, 30000);
    if (!res.ok) await this.fail(res);
    const j = (await res.json()) as { text?: string };
    return (j.text ?? '').trim();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Retries 429 and 5xx with backoff (1 s, then 3 s). When the model has been retired (404), refreshes the
 * model list once and switches to the configured fallback.
 */
export async function completeWithRetry(provider: LlmProvider, req: LlmRequest, opts: { fallbackModel?: string; backoffMs?: number[]; onSwitch?: (model: string) => void } = {}): Promise<LlmResponse> {
  const backoff = opts.backoffMs ?? [1000, 3000];
  let model = req.model;
  let switched = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.complete({ ...req, model });
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      if (e.kind === 'model_not_found' && !switched && opts.fallbackModel && opts.fallbackModel !== model) {
        switched = true;
        let next = opts.fallbackModel;
        try { const models = await provider.listModels(); if (!models.includes(next)) next = models.find((m) => /gpt-oss-120b|qwen|llama|gemini/.test(m)) ?? next; } catch { /* keep the configured fallback */ }
        model = next;
        opts.onSwitch?.(model);
        continue;
      }
      if ((e.kind === 'rate_limit' || e.kind === 'server') && attempt < backoff.length) {
        await sleep(Math.min(e.retryAfterMs ?? backoff[attempt], 8000));
        continue;
      }
      throw e;
    }
  }
}
