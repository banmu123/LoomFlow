/**
 * DesktopAIService — 本地 LLM 调用服务
 *
 * 直接从前端调用 LLM API（OpenAI 兼容格式）。
 * 所有模型通过 ai_models 表配置，支持 streaming。
 */

import type { AIModelRecord, MessageRecord } from './repositories/workflow-repository';

// ===== Types =====

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamChatOptions {
  model: AIModelRecord;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

// ===== Provider Base URLs (fallbacks when model.base_url is null) =====

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434/v1',
  custom: '',
};

// ===== Streaming Chat =====

export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { model, messages, signal, onChunk, onDone, onError } = options;

  const baseUrl = (model.baseUrl || DEFAULT_BASE_URLS[model.provider] || '').replace(/\/+$/, '');
  const apiKey = model.apiKey || '';

  if (!baseUrl) {
    onError(new Error(`No base URL configured for provider: ${model.provider}`));
    return;
  }

  // Claude uses a different API format
  if (model.provider === 'claude') {
    return streamClaude({ baseUrl, apiKey, model, messages, signal, onChunk, onDone, onError });
  }

  // Gemini uses a different API format
  if (model.provider === 'gemini') {
    return streamGemini({ baseUrl, apiKey, model, messages, signal, onChunk, onDone, onError });
  }

  // All others: OpenAI-compatible format
  return streamOpenAICompatible({ baseUrl, apiKey, model, messages, signal, onChunk, onDone, onError });
}

// ===== OpenAI-Compatible (DeepSeek, Qwen, Ark, Custom, Ollama, OpenAI) =====

async function streamOpenAICompatible(opts: {
  baseUrl: string;
  apiKey: string;
  model: AIModelRecord;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}): Promise<void> {
  const { baseUrl, apiKey, model, messages, signal, onChunk, onDone, onError } = opts;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model.modelName,
        messages,
        stream: true,
      }),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      onError(new Error(`API error ${res.status}: ${errBody}`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { onError(new Error('No response body')); return; }

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    onDone(fullText);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    onError(err as Error);
  }
}

// ===== Claude (Anthropic Messages API) =====

async function streamClaude(opts: {
  baseUrl: string;
  apiKey: string;
  model: AIModelRecord;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}): Promise<void> {
  const { baseUrl, apiKey, model, messages, signal, onChunk, onDone, onError } = opts;

  try {
    // Extract system message
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    const res = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.modelName,
        max_tokens: 4096,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      onError(new Error(`Claude API error ${res.status}: ${errBody}`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { onError(new Error('No response body')); return; }

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
            onChunk(parsed.delta.text);
          }
        } catch {
          // Skip
        }
      }
    }

    onDone(fullText);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    onError(err as Error);
  }
}

// ===== Gemini (Google Generative Language API) =====

async function streamGemini(opts: {
  baseUrl: string;
  apiKey: string;
  model: AIModelRecord;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}): Promise<void> {
  const { baseUrl, apiKey, model, messages, signal, onChunk, onDone, onError } = opts;

  try {
    const url = `${baseUrl}/models/${model.modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;

    // Convert messages to Gemini format
    const systemMsg = messages.find((m) => m.role === 'system');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
        contents,
      }),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      onError(new Error(`Gemini API error ${res.status}: ${errBody}`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { onError(new Error('No response body')); return; }

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullText += text;
            onChunk(text);
          }
        } catch {
          // Skip
        }
      }
    }

    onDone(fullText);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    onError(err as Error);
  }
}

// ===== Convert MessageRecord to ChatMessage =====

export function toChatMessages(messages: MessageRecord[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}
