import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import BeeperDesktop from '@beeper/desktop-api'
import WebSocket from 'ws'
import type { HistoryMessage, IncomingMessage } from './types.js'

const SETUP_PUBLIC_TOKEN = 'setup-login-public-client'

/** Resolve the Beeper Server API base URL: env > beeper CLI target file > default managed-server port. */
export function resolveBaseURL(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BEEPER_BASE_URL) return env.BEEPER_BASE_URL
  const dir = env.BEEPER_CLI_CONFIG_DIR || join(env.BEEPER_HOME || homedir(), '.beeper')
  for (const id of ['server', 'default']) {
    try {
      const t = JSON.parse(readFileSync(join(dir, 'targets', `${id}.json`), 'utf8')) as { baseURL?: string }
      if (t.baseURL) return t.baseURL
    } catch { /* try next */ }
  }
  return 'http://127.0.0.1:23374'
}

/** Read an access token saved by `beeper` CLI for the server target, if any. */
export function cliToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.BEEPER_CLI_CONFIG_DIR || join(env.BEEPER_HOME || homedir(), '.beeper')
  try {
    const t = JSON.parse(readFileSync(join(dir, 'targets', 'server.json'), 'utf8')) as { auth?: { accessToken?: string } }
    return t.auth?.accessToken
  } catch {
    return undefined
  }
}

type Raw = Record<string, unknown>

export class Beeper {
  private client: BeeperDesktop
  private setupClient: BeeperDesktop

  constructor(readonly baseURL: string, private token: string | undefined) {
    this.client = new BeeperDesktop({ baseURL, accessToken: token || SETUP_PUBLIC_TOKEN, logLevel: 'warn', maxRetries: 1 })
    this.setupClient = new BeeperDesktop({ baseURL, accessToken: SETUP_PUBLIC_TOKEN, logLevel: 'warn', maxRetries: 1 })
  }

  get hasToken(): boolean {
    return !!this.token
  }

  setToken(token: string): void {
    this.token = token
    this.client = new BeeperDesktop({ baseURL: this.baseURL, accessToken: token, logLevel: 'warn', maxRetries: 1 })
  }

  // ---- sign-in / verification -------------------------------------------------
  async state(): Promise<Raw> {
    return (await (this.token ? this.client : this.setupClient).app.setup.retrieve()) as unknown as Raw
  }

  async emailStart(email: string): Promise<{ setupRequestID: string }> {
    const start = await this.setupClient.app.setup.start()
    await this.setupClient.app.setup.email({ setupRequestID: start.setupRequestID, email })
    return { setupRequestID: start.setupRequestID }
  }

  /** Returns either { token, session } on success or { registrationRequired } when the email has no account yet. */
  async emailCode(setupRequestID: string, code: string, register?: { username: string }): Promise<{ token?: string; session?: unknown; registrationRequired?: unknown }> {
    const out = (await this.setupClient.app.setup.response({ setupRequestID, response: code })) as unknown as Raw
    let result = out
    if (!('matrix' in out)) {
      if (!register) return { registrationRequired: out }
      result = (await this.setupClient.app.setup.register({
        acceptTerms: true,
        leadToken: String(out.leadToken ?? ''),
        setupRequestID: String(out.setupRequestID ?? setupRequestID),
        username: register.username,
      } as never)) as unknown as Raw
    }
    const matrix = result.matrix as { accessToken?: string } | undefined
    if (!matrix?.accessToken) throw new Error('Beeper did not return an access token')
    this.setToken(matrix.accessToken)
    return { token: matrix.accessToken, session: result.session }
  }

  async verifyStart(): Promise<unknown> {
    return (await this.client.app.setup.verifications.create({})).session
  }

  async verifyAction(id: string, action: 'accept' | 'sas.start' | 'sas.confirm' | 'cancel'): Promise<unknown> {
    const v = this.client.app.setup.verifications
    if (action === 'accept') return (await v.accept(id)).session
    if (action === 'sas.start') return (await v.sas.start(id)).session
    if (action === 'sas.confirm') return (await v.sas.confirm(id)).session
    return (await v.cancel(id)).session
  }

  async recoveryKey(recoveryKey: string): Promise<unknown> {
    return (await this.client.app.setup.recoveryKey.verify({ recoveryKey })).session
  }

  // ---- networks ----------------------------------------------------------------
  async accounts(): Promise<unknown> {
    return this.client.accounts.list()
  }

  async bridges(): Promise<unknown> {
    return this.client.bridges.list()
  }

  async loginFlows(bridgeID: string): Promise<unknown> {
    return this.client.bridges.loginFlows.list(bridgeID)
  }

  async loginStart(bridgeID: string, flowID?: string): Promise<unknown> {
    return this.client.bridges.loginSessions.create(bridgeID, flowID ? { flowID } : {})
  }

  async loginGet(bridgeID: string, loginSessionID: string): Promise<unknown> {
    return this.client.bridges.loginSessions.retrieve(loginSessionID, { bridgeID })
  }

  async loginSubmit(bridgeID: string, loginSessionID: string, stepID: string, type: 'user_input' | 'cookies' | 'display_and_wait', fields?: Record<string, string>): Promise<unknown> {
    return this.client.bridges.loginSessions.steps.submit(stepID, { bridgeID, loginSessionID, type, fields, source: 'api' })
  }

  async loginCancel(bridgeID: string, loginSessionID: string): Promise<unknown> {
    return this.client.bridges.loginSessions.cancel(loginSessionID, { bridgeID })
  }

  // ---- chats & messages --------------------------------------------------------
  async listChats(max = 200): Promise<Array<{ id: string; title: string; network: string; type: 'single' | 'group'; lastActivity?: string; participants: Array<{ isSelf?: boolean }>; accountID: string }>> {
    const out = []
    for await (const chat of this.client.chats.list({ limit: 50 })) {
      out.push({
        id: chat.id,
        title: chat.title,
        network: chat.network,
        type: chat.type,
        lastActivity: chat.lastActivity,
        participants: chat.participants?.items ?? [],
        accountID: chat.accountID,
      })
      if (out.length >= max) break
    }
    return out
  }

  async getChat(chatID: string): Promise<{ id: string; title: string; network: string; type: 'single' | 'group' } | null> {
    try {
      const c = await this.client.chats.retrieve(chatID)
      return { id: c.id, title: c.title, network: c.network, type: c.type }
    } catch {
      return null
    }
  }

  async history(chatID: string, count: number): Promise<HistoryMessage[]> {
    const page = await this.client.messages.list(chatID)
    const items = page.items
      .filter(m => !m.isDeleted && !m.isHidden && (m.type === undefined || m.type === 'TEXT') && m.text)
      .map(m => ({ id: m.id, isSender: !!m.isSender, senderName: m.senderName, text: m.text ?? '', timestamp: m.timestamp, sortKey: m.sortKey }))
    items.sort((a, b) => compareSortKey(a.sortKey, b.sortKey) || a.timestamp.localeCompare(b.timestamp))
    return items.slice(-count)
  }

  async send(chatID: string, text: string, replyToMessageID?: string): Promise<{ pendingMessageID: string }> {
    const res = await this.client.messages.send(chatID, { text, ...(replyToMessageID ? { replyToMessageID } : {}) })
    return { pendingMessageID: res.pendingMessageID }
  }

  async typing(chatID: string, on: boolean): Promise<void> {
    try {
      await this.client.post(`/v1/chats/${encodeURIComponent(chatID)}/typing`, { body: { state: on ? 'typing' : 'paused' } })
    } catch { /* best effort */ }
  }

  // ---- live events -------------------------------------------------------------
  /** Connect to the WebSocket event stream with automatic reconnect. */
  watch(onMessage: (m: IncomingMessage) => void, onStatus: (s: string) => void): () => void {
    let ws: WebSocket | null = null
    let stopped = false
    let backoff = 1000
    const connect = () => {
      if (stopped) return
      if (!this.token) {
        onStatus('waiting for Beeper sign-in')
        setTimeout(connect, 5000)
        return
      }
      const url = new URL('/v1/ws', this.baseURL)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.token}` } })
      ws.on('open', () => {
        backoff = 1000
        onStatus('connected')
        ws?.send(JSON.stringify({ type: 'subscriptions.set', requestID: 'all', chatIDs: ['*'] }))
      })
      ws.on('message', data => {
        for (const m of parseEvent(data.toString())) onMessage(m)
      })
      ws.on('error', err => onStatus(`websocket error: ${err.message}`))
      ws.on('close', () => {
        if (stopped) return
        onStatus('disconnected, retrying')
        setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, 60_000)
      })
    }
    connect()
    return () => {
      stopped = true
      ws?.close()
    }
  }
}

export function compareSortKey(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = BigInt(a)
    const y = BigInt(b)
    return x < y ? -1 : x > y ? 1 : 0
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/** Turn a raw WebSocket frame into incoming messages (only message.upserted with entries). */
export function parseEvent(frame: string): IncomingMessage[] {
  let ev: { type?: string; chatID?: string; entries?: Array<Record<string, unknown>> }
  try {
    ev = JSON.parse(frame)
  } catch {
    return []
  }
  if (ev.type !== 'message.upserted' || !Array.isArray(ev.entries)) return []
  return ev.entries
    .filter(e => typeof e.id === 'string')
    .map(e => ({
      id: String(e.id),
      chatID: String(e.chatID ?? ev.chatID ?? ''),
      isSender: !!e.isSender,
      text: typeof e.text === 'string' ? e.text : '',
      type: typeof e.type === 'string' ? e.type : undefined,
      timestamp: typeof e.timestamp === 'string' ? e.timestamp : new Date().toISOString(),
      senderName: typeof e.senderName === 'string' ? e.senderName : undefined,
      isDeleted: !!e.isDeleted,
      isHidden: !!e.isHidden,
    }))
    .filter(m => m.chatID)
}
