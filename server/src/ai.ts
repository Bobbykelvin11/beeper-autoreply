import type { ChatMessageParam } from './policy.js'
import type { ProviderSettings } from './types.js'

export async function chatCompletion(provider: ProviderSettings, messages: ChatMessageParam[], fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!provider.baseURL) throw new Error('AI provider base URL is not set')
  const url = provider.baseURL.replace(/\/+$/, '') + '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: provider.model, messages, temperature: provider.temperature, max_tokens: 400, stream: false }),
    signal: AbortSignal.timeout(120_000),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`AI provider HTTP ${res.status}: ${body.slice(0, 300)}`)
  let data: { choices?: Array<{ message?: { content?: string } }> }
  try {
    data = JSON.parse(body)
  } catch {
    throw new Error('AI provider returned non-JSON')
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('AI provider returned no message')
  return content
}

export const PROVIDER_PRESETS = [
  { id: 'ollama', label: 'Ollama on this server (free, open source, slower)', baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:3b', needsKey: false },
  { id: 'groq', label: 'Groq (free tier, fast)', baseURL: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter (free models available)', baseURL: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', needsKey: true },
  { id: 'gemini', label: 'Google Gemini (free tier, OpenAI-compatible)', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', needsKey: true },
]
