import { randomBytes } from 'node:crypto'
import { chatCompletion } from './ai.js'
import type { Beeper } from './beeper.js'
import { RateLimiter, buildPrompt, cleanReply, decide, humanDelayMs, parseNoteCommand } from './policy.js'
import type { Store } from './store.js'
import type { ChatSettings, Draft, IncomingMessage, Mode } from './types.js'

const BOT_PREFIX = '🤖'

export interface EngineDeps {
  store: Store
  beeper: Beeper
  complete?: typeof chatCompletion
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout
}

export class Engine {
  readonly limiter: RateLimiter
  private debounce = new Map<string, { timer: NodeJS.Timeout; message: IncomingMessage; mode: Mode; reason: string }>()
  private scheduled = new Map<string, NodeJS.Timeout>()
  private ownSends = new Map<string, Array<{ text: string; ts: number }>>()
  private detectedNoteToSelf = ''
  private readonly store: Store
  private readonly beeper: Beeper
  private readonly complete: typeof chatCompletion
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => NodeJS.Timeout

  constructor(deps: EngineDeps) {
    this.store = deps.store
    this.beeper = deps.beeper
    this.complete = deps.complete ?? chatCompletion
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.limiter = new RateLimiter(this.now)
    this.limiter.load(this.store.state.sends)
  }

  get noteToSelfChatID(): string {
    return this.store.state.settings.noteToSelf.chatID || this.detectedNoteToSelf
  }

  /** Refresh chat titles/types from Beeper, keeping the user's per-chat choices. */
  async refreshChats(): Promise<void> {
    const chats = await this.beeper.listChats()
    for (const c of chats) {
      const existing = this.store.state.chats[c.id]
      this.store.state.chats[c.id] = {
        chatID: c.id,
        title: c.title,
        network: c.network,
        type: c.type,
        allowed: existing?.allowed ?? false,
        mode: existing?.mode ?? 'default',
        instructions: existing?.instructions ?? '',
      }
      const parts = c.participants
      if (!this.detectedNoteToSelf && c.type === 'single' && parts.length > 0 && parts.every(p => p.isSelf)) {
        this.detectedNoteToSelf = c.id
      }
    }
    this.store.scheduleSave()
  }

  async onMessage(m: IncomingMessage): Promise<void> {
    if (!this.store.markSeen(`${m.chatID}|${m.id}`)) return
    const settings = this.store.state.settings
    const nts = this.noteToSelfChatID

    if (m.chatID === nts && m.chatID) {
      if (m.isSender && !m.text.startsWith(BOT_PREFIX) && settings.noteToSelf.enabled) await this.handleNoteCommand(m.text)
      return
    }

    if (m.isSender) {
      if (this.isOwnBotSend(m.chatID, m.text)) return
      // The owner replied by hand: stop anything queued for this chat.
      this.cancelChat(m.chatID, 'you replied yourself')
      return
    }

    let chat = this.store.state.chats[m.chatID]
    if (!chat) {
      const c = await this.beeper.getChat(m.chatID)
      if (c) {
        chat = { chatID: c.id, title: c.title, network: c.network, type: c.type, allowed: false, mode: 'default', instructions: '' }
        this.store.state.chats[c.id] = chat
        this.store.scheduleSave()
      }
    }

    const decision = decide({ settings, chat, message: m, noteToSelfChatID: nts, now: new Date(this.now()) })
    if (decision.action === 'ignore') {
      if (chat?.allowed && decision.reason !== 'bot is off') this.store.log('info', `Not replying: ${decision.reason}`, m.chatID)
      return
    }

    const prev = this.debounce.get(m.chatID)
    if (prev) clearTimeout(prev.timer)
    const timer = this.setTimer(() => {
      this.debounce.delete(m.chatID)
      void this.generate(m.chatID, m, decision.mode, decision.reason).catch(err => this.store.log('error', `Reply failed: ${errMsg(err)}`, m.chatID))
    }, Math.max(0, settings.delay.debounceSeconds) * 1000)
    this.debounce.set(m.chatID, { timer, message: m, mode: decision.mode, reason: decision.reason })
  }

  async generate(chatID: string, incoming: IncomingMessage, mode: Mode, reason: string): Promise<Draft | null> {
    const settings = this.store.state.settings
    const chat = this.store.state.chats[chatID]
    const history = await this.beeper.history(chatID, settings.historyCount + 5)
    if (!history.some(h => h.id === incoming.id)) {
      history.push({ id: incoming.id, isSender: false, senderName: incoming.senderName, text: incoming.text, timestamp: incoming.timestamp, sortKey: '' })
    }
    const last = history.at(-1)
    if (last?.isSender && !this.isOwnBotSend(chatID, last.text, true)) {
      this.store.log('info', 'Skipped: you already replied', chatID)
      return null
    }
    const messages = buildPrompt({ settings, chat, history })
    const raw = await this.complete(settings.provider, messages)
    const text = cleanReply(raw, settings)
    if (!text) {
      this.store.log('info', 'AI decided this one needs you (skipped)', chatID)
      await this.notify(`"${chat?.title ?? 'A chat'}" needs your reply: “${truncate(incoming.text, 140)}”`)
      return null
    }
    const draft: Draft = {
      id: this.newDraftID(),
      chatID,
      chatTitle: chat?.title ?? chatID,
      network: chat?.network ?? '',
      incomingText: incoming.text,
      incomingMessageID: incoming.id,
      text,
      createdAt: this.now(),
      updatedAt: this.now(),
      status: 'pending',
      reason,
    }
    // supersede older pending drafts for this chat
    for (const d of this.store.state.drafts) {
      if (d.chatID === chatID && d.status === 'pending') {
        d.status = 'superseded'
        d.updatedAt = this.now()
        this.clearScheduled(d.id)
      }
    }
    this.store.state.drafts.push(draft)
    this.store.scheduleSave()

    if (mode === 'auto') {
      const blocked = this.limiter.check(chatID, settings.rateLimits)
      if (blocked) {
        draft.reason = `held for approval: ${blocked}`
        this.store.log('warn', `Auto-send held: ${blocked}`, chatID)
        await this.notifyDraft(draft)
        return draft
      }
      const delay = humanDelayMs(settings, text)
      this.store.log('info', `Auto-reply scheduled in ${Math.round(delay / 1000)}s`, chatID)
      if (settings.delay.typing) {
        this.setTimer(() => void this.beeper.typing(chatID, true), Math.max(0, delay - Math.min(8000, delay / 2)))
      }
      this.scheduled.set(draft.id, this.setTimer(() => {
        this.scheduled.delete(draft.id)
        void this.sendDraft(draft.id, undefined, { automatic: true }).catch(err => this.store.log('error', `Auto-send failed: ${errMsg(err)}`, chatID))
      }, delay))
      return draft
    }

    this.store.log('info', 'Draft waiting for your approval', chatID)
    await this.notifyDraft(draft)
    return draft
  }

  async sendDraft(id: string, editedText?: string, opts: { automatic?: boolean } = {}): Promise<Draft> {
    const draft = this.findDraft(id)
    if (!draft) throw new Error('Draft not found')
    if (draft.status !== 'pending') throw new Error(`Draft is already ${draft.status}`)
    const settings = this.store.state.settings
    if (opts.automatic) {
      if (!settings.enabled) {
        draft.reason = 'bot was turned off before sending'
        return draft
      }
      const blocked = this.limiter.check(draft.chatID, settings.rateLimits)
      if (blocked) {
        draft.reason = `held for approval: ${blocked}`
        await this.notifyDraft(draft)
        return draft
      }
    }
    const text = (editedText ?? draft.text).trim()
    if (!text) throw new Error('Message is empty')
    this.clearScheduled(id)
    this.rememberOwnSend(draft.chatID, text)
    try {
      await this.beeper.send(draft.chatID, text)
    } catch (err) {
      draft.status = 'failed'
      draft.error = errMsg(err)
      draft.updatedAt = this.now()
      this.store.log('error', `Send failed: ${draft.error}`, draft.chatID)
      this.store.scheduleSave()
      throw err
    }
    if (settings.delay.typing) void this.beeper.typing(draft.chatID, false)
    draft.text = text
    draft.status = 'sent'
    draft.updatedAt = this.now()
    this.limiter.record(draft.chatID)
    this.store.state.sends = this.limiter.snapshot()
    this.store.log('info', `${opts.automatic ? 'Auto-sent' : 'Sent approved'} reply`, draft.chatID)
    this.store.scheduleSave()
    return draft
  }

  rejectDraft(id: string): Draft {
    const draft = this.findDraft(id)
    if (!draft) throw new Error('Draft not found')
    if (draft.status !== 'pending') throw new Error(`Draft is already ${draft.status}`)
    this.clearScheduled(id)
    draft.status = 'rejected'
    draft.updatedAt = this.now()
    this.store.log('info', 'Draft rejected', draft.chatID)
    this.store.scheduleSave()
    return draft
  }

  updateChat(chatID: string, patch: Partial<Pick<ChatSettings, 'allowed' | 'mode' | 'instructions'>>): ChatSettings {
    const chat = this.store.state.chats[chatID]
    if (!chat) throw new Error('Unknown chat')
    if (typeof patch.allowed === 'boolean') chat.allowed = patch.allowed
    if (patch.mode === 'default' || patch.mode === 'approve' || patch.mode === 'auto') chat.mode = patch.mode
    if (typeof patch.instructions === 'string') chat.instructions = patch.instructions.slice(0, 1000)
    if (!chat.allowed) this.cancelChat(chatID, 'chat removed from allowlist')
    this.store.scheduleSave()
    return chat
  }

  cancelAll(reason: string): void {
    for (const chatID of new Set([...this.debounce.keys(), ...this.store.state.drafts.filter(d => d.status === 'pending').map(d => d.chatID)])) {
      const entry = this.debounce.get(chatID)
      if (entry) clearTimeout(entry.timer)
      this.debounce.delete(chatID)
    }
    for (const [id, t] of this.scheduled) {
      clearTimeout(t)
      this.scheduled.delete(id)
      const d = this.findDraft(id)
      if (d) d.reason = `auto-send stopped: ${reason}`
    }
  }

  private cancelChat(chatID: string, reason: string): void {
    const entry = this.debounce.get(chatID)
    if (entry) {
      clearTimeout(entry.timer)
      this.debounce.delete(chatID)
    }
    for (const d of this.store.state.drafts) {
      if (d.chatID === chatID && d.status === 'pending') {
        this.clearScheduled(d.id)
        d.status = 'superseded'
        d.reason = reason
        d.updatedAt = this.now()
      }
    }
    this.store.scheduleSave()
  }

  private async handleNoteCommand(text: string): Promise<void> {
    const cmd = parseNoteCommand(text)
    if (!cmd) return
    try {
      if (cmd.kind === 'send') {
        const d = await this.sendDraft(cmd.id, cmd.text)
        await this.notify(`Sent to ${d.chatTitle} ✅`)
      } else if (cmd.kind === 'reject') {
        const d = this.rejectDraft(cmd.id)
        await this.notify(`Rejected draft for ${d.chatTitle}`)
      } else if (cmd.kind === 'mode') {
        this.store.state.settings.enabled = cmd.mode === 'on'
        if (cmd.mode === 'off') this.cancelAll('bot turned off')
        this.store.scheduleSave()
        await this.notify(`Auto-reply bot is now ${cmd.mode.toUpperCase()}`)
      } else {
        const pending = this.store.state.drafts.filter(d => d.status === 'pending')
        await this.notify(pending.length ? pending.map(d => `#${d.id} ${d.chatTitle}: ${truncate(d.text, 80)}`).join('\n') : 'No pending drafts')
      }
    } catch (err) {
      await this.notify(`Couldn't do that: ${errMsg(err)}`)
    }
  }

  private async notifyDraft(draft: Draft): Promise<void> {
    await this.notify(
      `Draft #${draft.id} for ${draft.chatTitle}${draft.network ? ` (${draft.network})` : ''}\n` +
      `They said: “${truncate(draft.incomingText, 200)}”\n` +
      `Reply: “${draft.text}”\n` +
      `Type: ok ${draft.id} · no ${draft.id} · edit ${draft.id} your text`,
    )
  }

  async notify(text: string): Promise<void> {
    const s = this.store.state.settings.noteToSelf
    const chatID = this.noteToSelfChatID
    if (!s.enabled || !chatID) return
    const msg = `${BOT_PREFIX} ${text}`
    this.rememberOwnSend(chatID, msg)
    try {
      await this.beeper.send(chatID, msg)
    } catch (err) {
      this.store.log('warn', `Note-to-self notify failed: ${errMsg(err)}`)
    }
  }

  private rememberOwnSend(chatID: string, text: string): void {
    const list = (this.ownSends.get(chatID) ?? []).filter(e => this.now() - e.ts < 10 * 60_000)
    list.push({ text: text.trim(), ts: this.now() })
    this.ownSends.set(chatID, list)
  }

  private isOwnBotSend(chatID: string, text: string, keep = false): boolean {
    const list = this.ownSends.get(chatID) ?? []
    const idx = list.findIndex(e => e.text === text.trim() && this.now() - e.ts < 10 * 60_000)
    if (idx === -1) return false
    if (!keep) list.splice(idx, 1)
    return true
  }

  private clearScheduled(id: string): void {
    const t = this.scheduled.get(id)
    if (t) clearTimeout(t)
    this.scheduled.delete(id)
  }

  private findDraft(id: string): Draft | undefined {
    const want = id.toLowerCase().replace(/^#/, '')
    const matches = this.store.state.drafts.filter(d => d.id === want)
    return matches.find(d => d.status === 'pending') ?? matches.at(-1)
  }

  private newDraftID(): string {
    for (;;) {
      const id = randomBytes(3).readUIntBE(0, 3).toString(36).padStart(4, '0').slice(-4)
      if (!this.store.state.drafts.some(d => d.id === id && d.status === 'pending')) return id
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
