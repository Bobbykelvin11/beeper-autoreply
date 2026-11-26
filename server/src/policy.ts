import type { ChatSettings, HistoryMessage, IncomingMessage, Mode, Settings } from './types.js'

/** Minutes since midnight for "HH:MM"; NaN if invalid. */
export function parseHHMM(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return Number.NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return Number.NaN
  return h * 60 + min
}

/** Local minutes-of-day for a Date in the given IANA time zone. */
export function minutesInZone(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
    return h * 60 + m
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes()
  }
}

export function isQuietTime(settings: Settings, now: Date): boolean {
  const q = settings.quietHours
  if (!q.enabled) return false
  const start = parseHHMM(q.start)
  const end = parseHHMM(q.end)
  if (Number.isNaN(start) || Number.isNaN(end) || start === end) return false
  const cur = minutesInZone(now, q.timeZone)
  return start < end ? cur >= start && cur < end : cur >= start || cur < end
}

export function effectiveMode(settings: Settings, chat: ChatSettings | undefined): Mode {
  if (!chat || chat.mode === 'default') return settings.defaultMode
  return chat.mode
}

export type Decision =
  | { action: 'ignore'; reason: string }
  | { action: 'reply'; mode: Mode; reason: string }

export const MAX_EVENT_AGE_MS = 10 * 60 * 1000

/** Decide whether an incoming message should get an AI reply and in which mode. */
export function decide(opts: {
  settings: Settings
  chat: ChatSettings | undefined
  message: IncomingMessage
  noteToSelfChatID: string
  now: Date
}): Decision {
  const { settings, chat, message, now } = opts
  if (!settings.enabled) return { action: 'ignore', reason: 'bot is off' }
  if (message.isSender) return { action: 'ignore', reason: 'own message' }
  if (message.chatID === opts.noteToSelfChatID) return { action: 'ignore', reason: 'note to self' }
  if (message.isDeleted || message.isHidden) return { action: 'ignore', reason: 'deleted/hidden' }
  if (message.type && message.type !== 'TEXT') return { action: 'ignore', reason: `unsupported type ${message.type}` }
  if (!message.text || !message.text.trim()) return { action: 'ignore', reason: 'empty text' }
  const ts = Date.parse(message.timestamp)
  if (Number.isFinite(ts) && now.getTime() - ts > MAX_EVENT_AGE_MS) return { action: 'ignore', reason: 'old message (backfill)' }
  const isGroup = chat?.type === 'group'
  if (isGroup && !settings.allowGroups) return { action: 'ignore', reason: 'groups disabled' }
  const allowed = chat?.allowed || (!isGroup && settings.allowAllDirectChats && chat !== undefined)
  if (!allowed) return { action: 'ignore', reason: 'chat not on allowlist' }
  let mode = effectiveMode(settings, chat)
  if (mode === 'auto' && isQuietTime(settings, now)) {
    if (settings.quietHours.behavior === 'skip') return { action: 'ignore', reason: 'quiet hours' }
    mode = 'approve'
    return { action: 'reply', mode, reason: 'quiet hours: held for approval' }
  }
  return { action: 'reply', mode, reason: mode === 'auto' ? 'auto mode' : 'approval mode' }
}

/** Human-like delay in ms: random in [min,max] plus a little per character of the reply. */
export function humanDelayMs(settings: Settings, replyText: string, rand: () => number = Math.random): number {
  const min = Math.max(0, settings.delay.minSeconds)
  const max = Math.max(min, settings.delay.maxSeconds)
  const base = min + (max - min) * rand()
  const typing = Math.min(30, replyText.length * 0.06)
  return Math.round((base + typing) * 1000)
}

export class RateLimiter {
  private sends: Array<{ chatID: string; ts: number }> = []

  constructor(private readonly now: () => number = Date.now) {}

  record(chatID: string): void {
    this.sends.push({ chatID, ts: this.now() })
    this.prune()
  }

  /** Returns null if allowed, otherwise the reason it is blocked. */
  check(chatID: string, limits: Settings['rateLimits']): string | null {
    this.prune()
    const now = this.now()
    const chatSends = this.sends.filter(s => s.chatID === chatID)
    if (this.sends.length >= limits.globalPerHour) return `global limit ${limits.globalPerHour}/hour reached`
    if (chatSends.length >= limits.perChatPerHour) return `chat limit ${limits.perChatPerHour}/hour reached`
    const last = chatSends.at(-1)
    if (last && now - last.ts < limits.minGapSecondsPerChat * 1000) return `min gap ${limits.minGapSecondsPerChat}s not reached`
    return null
  }

  load(entries: Array<{ chatID: string; ts: number }>): void {
    this.sends = entries.slice()
    this.prune()
  }

  snapshot(): Array<{ chatID: string; ts: number }> {
    this.prune()
    return this.sends.slice()
  }

  private prune(): void {
    const cutoff = this.now() - 60 * 60 * 1000
    this.sends = this.sends.filter(s => s.ts > cutoff)
  }
}

export const SKIP_TOKEN = '[[SKIP]]'

export interface ChatMessageParam {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function buildPrompt(opts: {
  settings: Settings
  chat: ChatSettings | undefined
  history: HistoryMessage[]
  ownerName?: string
}): ChatMessageParam[] {
  const { settings, chat, history } = opts
  const system = [
    settings.persona.trim(),
    `Reply style: ${settings.style.trim()}`,
    chat?.instructions?.trim() ? `Extra instructions for this chat: ${chat.instructions.trim()}` : '',
    `You are writing the NEXT message from the owner${opts.ownerName ? ` (${opts.ownerName})` : ''} in this ${chat?.type === 'group' ? 'group chat' : 'one-to-one chat'}${chat?.title ? ` with "${chat.title}"` : ''} on ${chat?.network || 'a messaging app'}.`,
    'Output ONLY the message text, with no quotes, no name prefix and no explanations.',
    `Never agree to send money, share passwords or codes, make firm commitments, or discuss anything you cannot know from the chat. If the message needs the real owner (money, plans, emergencies, sensitive or unclear topics), output exactly ${SKIP_TOKEN}.`,
    `Keep it under ${settings.maxReplyChars} characters.`,
  ].filter(Boolean).join('\n')
  const messages: ChatMessageParam[] = [{ role: 'system', content: system }]
  const recent = history.slice(-Math.max(1, settings.historyCount))
  for (const m of recent) {
    const text = m.text.trim()
    if (!text) continue
    if (m.isSender) messages.push({ role: 'assistant', content: text })
    else messages.push({ role: 'user', content: chat?.type === 'group' && m.senderName ? `${m.senderName}: ${text}` : text })
  }
  return mergeConsecutive(messages)
}

function mergeConsecutive(messages: ChatMessageParam[]): ChatMessageParam[] {
  const out: ChatMessageParam[] = []
  for (const m of messages) {
    const last = out.at(-1)
    if (last && last.role === m.role && m.role !== 'system') last.content += `\n${m.content}`
    else out.push({ ...m })
  }
  return out
}

/** Clean an AI reply. Returns null when the model chose to skip. */
export function cleanReply(raw: string, settings: Settings): string | null {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (!text || text.includes(SKIP_TOKEN)) return null
  text = text.replace(/^["'“”]+|["'“”]+$/g, '').replace(/^(me|owner|assistant)\s*:\s*/i, '').trim()
  if (!text) return null
  if (text.length > settings.maxReplyChars) text = text.slice(0, settings.maxReplyChars).replace(/\s+\S*$/, '') + '…'
  if (settings.addAutoTag && settings.autoTag) text += settings.autoTag
  return text
}

export type NoteCommand =
  | { kind: 'send'; id: string; text?: string }
  | { kind: 'reject'; id: string }
  | { kind: 'mode'; mode: 'on' | 'off' }
  | { kind: 'list' }

/** Parse commands the owner types in their Beeper "Note to self" chat. */
export function parseNoteCommand(text: string): NoteCommand | null {
  const t = text.trim()
  let m = /^(?:ok|send|yes|y)\s+#?([a-z0-9]{4,8})\s*$/i.exec(t)
  if (m) return { kind: 'send', id: m[1]!.toLowerCase() }
  m = /^edit\s+#?([a-z0-9]{4,8})\s+([\s\S]+)$/i.exec(t)
  if (m) return { kind: 'send', id: m[1]!.toLowerCase(), text: m[2]!.trim() }
  m = /^(?:no|reject|skip|n)\s+#?([a-z0-9]{4,8})\s*$/i.exec(t)
  if (m) return { kind: 'reject', id: m[1]!.toLowerCase() }
  m = /^bot\s+(on|off)$/i.exec(t)
  if (m) return { kind: 'mode', mode: m[1]!.toLowerCase() as 'on' | 'off' }
  if (/^(?:drafts|pending)$/i.test(t)) return { kind: 'list' }
  return null
}
