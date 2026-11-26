export type Mode = 'approve' | 'auto'
export type ChatMode = Mode | 'default'

export interface QuietHours {
  enabled: boolean
  /** "HH:MM" 24h */
  start: string
  end: string
  /** IANA zone, e.g. America/New_York */
  timeZone: string
  /** what happens to auto-mode replies during quiet hours */
  behavior: 'hold-for-approval' | 'skip'
}

export interface ProviderSettings {
  /** OpenAI-compatible base URL, e.g. https://api.groq.com/openai/v1 or http://127.0.0.1:11434/v1 */
  baseURL: string
  apiKey: string
  model: string
  temperature: number
}

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
  quietHours: QuietHours
  delay: { minSeconds: number; maxSeconds: number; debounceSeconds: number; typing: boolean }
  rateLimits: { perChatPerHour: number; globalPerHour: number; minGapSecondsPerChat: number }
  provider: ProviderSettings
  noteToSelf: { enabled: boolean; chatID: string }
  draftTTLHours: number
}

export interface ChatSettings {
  chatID: string
  title: string
  network: string
  type: 'single' | 'group'
  allowed: boolean
  mode: ChatMode
  instructions: string
}

export type DraftStatus = 'pending' | 'sent' | 'rejected' | 'expired' | 'superseded' | 'failed'

export interface Draft {
  id: string
  chatID: string
  chatTitle: string
  network: string
  incomingText: string
  incomingMessageID: string
  text: string
  createdAt: number
  updatedAt: number
  status: DraftStatus
  reason: string
  error?: string
}

export interface LogEntry {
  ts: number
  level: 'info' | 'warn' | 'error'
  msg: string
  chatID?: string
}

export interface HistoryMessage {
  id: string
  isSender: boolean
  senderName?: string
  text: string
  timestamp: string
  sortKey: string
}

export interface IncomingMessage {
  id: string
  chatID: string
  isSender: boolean
  text: string
  type?: string
  timestamp: string
  senderName?: string
  isDeleted?: boolean
  isHidden?: boolean
}
