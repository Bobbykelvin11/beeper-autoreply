import type { Settings } from './types.js'

export const DEFAULT_PERSONA =
  'You are replying on behalf of the account owner, in their own voice, to people they chat with. ' +
  'Keep the conversation going naturally. Be friendly, short and casual like a real text message.'

export const DEFAULT_STYLE = 'Short (1-2 sentences), casual, match the language and tone of the other person, no hashtags, emojis only if they use them.'

export function defaultSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    enabled: false,
    defaultMode: 'approve',
    allowAllDirectChats: false,
    allowGroups: false,
    persona: DEFAULT_PERSONA,
    style: DEFAULT_STYLE,
    addAutoTag: false,
    autoTag: ' (auto-reply)',
    historyCount: 20,
    maxReplyChars: 600,
    quietHours: { enabled: false, start: '23:00', end: '07:00', timeZone: 'America/New_York', behavior: 'hold-for-approval' },
    delay: { minSeconds: 20, maxSeconds: 90, debounceSeconds: 15, typing: true },
    rateLimits: { perChatPerHour: 6, globalPerHour: 30, minGapSecondsPerChat: 45 },
    provider: {
      baseURL: env.AI_BASE_URL || 'https://api.groq.com/openai/v1',
      apiKey: env.AI_API_KEY || '',
      model: env.AI_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.7,
    },
    noteToSelf: { enabled: true, chatID: '' },
    draftTTLHours: 24,
  }
}

/** Deep-merge a partial settings patch onto settings, keeping only known keys. */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  return deepMerge(base, patch) as Settings
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base
  if (isPlainObject(base)) {
    if (!isPlainObject(patch)) return base
    const out: Record<string, unknown> = { ...base }
    for (const key of Object.keys(base)) {
      if (key in patch) out[key] = deepMerge(base[key], patch[key])
    }
    return out
  }
  if (typeof base === 'number') {
    const n = typeof patch === 'string' ? Number(patch) : patch
    return typeof n === 'number' && Number.isFinite(n) ? n : base
  }
  if (typeof base === 'boolean') return typeof patch === 'boolean' ? patch : base
  if (typeof base === 'string') return typeof patch === 'string' ? patch : base
  return base
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
