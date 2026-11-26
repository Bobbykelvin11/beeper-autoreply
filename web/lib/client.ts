'use client'

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export async function api<T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/vm/${path.replace(/^\//, '')}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error || `HTTP ${res.status}`)
  return data
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export type Mode = 'approve' | 'auto'
export type ChatMode = Mode | 'default'

export interface Settings {
  enabled: boolean
  defaultMode: Mode
  allowAllDirectChats: boolean
  allowGroups: boolean
  persona: string
  style: string
  addAutoTag: boolean
  autoTag: string
  historyCount: number
  maxReplyChars: number
  quietHours: { enabled: boolean; start: string; end: string; timeZone: string; behavior: 'hold-for-approval' | 'skip' }
  delay: { minSeconds: number; maxSeconds: number; debounceSeconds: number; typing: boolean }
  rateLimits: { perChatPerHour: number; globalPerHour: number; minGapSecondsPerChat: number }
  provider: { baseURL: string; apiKey: string; model: string; temperature: number }
  noteToSelf: { enabled: boolean; chatID: string }
  draftTTLHours: number
}

export interface Chat {
  chatID: string
  title: string
  network: string
  type: 'single' | 'group'
  allowed: boolean
  mode: ChatMode
  instructions: string
}

export interface Draft {
  id: string
  chatID: string
  chatTitle: string
  network: string
  incomingText: string
  text: string
  createdAt: number
  status: string
  reason: string
  error?: string
}
