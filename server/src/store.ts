import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, mergeSettings } from './defaults.js'
import type { ChatSettings, Draft, LogEntry, Settings } from './types.js'

export interface PersistedState {
  settings: Settings
  chats: Record<string, ChatSettings>
  drafts: Draft[]
  logs: LogEntry[]
  sends: Array<{ chatID: string; ts: number }>
  seen: string[]
}

export interface Secrets {
  beeperAccessToken?: string
}

const MAX_LOGS = 500
const MAX_SEEN = 2000
const MAX_DRAFTS = 300

/** Small JSON-file store with atomic writes. Good enough for one user on one VM. */
export class Store {
  state: PersistedState
  secrets: Secrets
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const raw = readJSON<Partial<PersistedState>>(join(dir, 'state.json')) ?? {}
    this.state = {
      settings: mergeSettings(defaultSettings(), raw.settings ?? {}),
      chats: raw.chats ?? {},
      drafts: raw.drafts ?? [],
      logs: raw.logs ?? [],
      sends: raw.sends ?? [],
      seen: raw.seen ?? [],
    }
    this.secrets = readJSON<Secrets>(join(dir, 'secrets.json')) ?? {}
  }

  log(level: LogEntry['level'], msg: string, chatID?: string): void {
    this.state.logs.push({ ts: Date.now(), level, msg, chatID })
    if (this.state.logs.length > MAX_LOGS) this.state.logs.splice(0, this.state.logs.length - MAX_LOGS)
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${chatID ? ` (${chatID})` : ''}`
    if (level === 'error') console.error(line)
    else console.log(line)
    this.scheduleSave()
  }

  markSeen(id: string): boolean {
    if (this.state.seen.includes(id)) return false
    this.state.seen.push(id)
    if (this.state.seen.length > MAX_SEEN) this.state.seen.splice(0, this.state.seen.length - MAX_SEEN)
    this.scheduleSave()
    return true
  }

  pruneDrafts(): void {
    const ttl = this.state.settings.draftTTLHours * 3600_000
    const now = Date.now()
    for (const d of this.state.drafts) {
      if (d.status === 'pending' && now - d.createdAt > ttl) {
        d.status = 'expired'
        d.updatedAt = now
      }
    }
    if (this.state.drafts.length > MAX_DRAFTS) {
      const keep = this.state.drafts.filter(d => d.status === 'pending')
      const rest = this.state.drafts.filter(d => d.status !== 'pending').slice(-(MAX_DRAFTS - keep.length))
      this.state.drafts = [...rest, ...keep].sort((a, b) => a.createdAt - b.createdAt)
    }
  }

  setSecrets(patch: Secrets): void {
    this.secrets = { ...this.secrets, ...patch }
    writeAtomic(join(this.dir, 'secrets.json'), JSON.stringify(this.secrets, null, 2))
  }

  scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, 500)
  }

  saveNow(): void {
    writeAtomic(join(this.dir, 'state.json'), JSON.stringify(this.state, null, 2))
  }
}

function readJSON<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  renameSync(tmp, path)
  try { chmodSync(path, 0o600) } catch { /* ignore */ }
}
