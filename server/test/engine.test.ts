import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../src/engine.js'
import { Store } from '../src/store.js'
import { mergeSettings } from '../src/defaults.js'
import { createApi } from '../src/api.js'
import type { Beeper } from '../src/beeper.js'
import type { HistoryMessage, IncomingMessage } from '../src/types.js'

function setup(mode: 'approve' | 'auto') {
  const store = new Store(mkdtempSync(join(tmpdir(), 'bar-')))
  store.state.settings = mergeSettings(store.state.settings, { enabled: true, defaultMode: mode, noteToSelf: { enabled: true, chatID: 'nts' }, delay: { debounceSeconds: 0, minSeconds: 0, maxSeconds: 0, typing: false } })
  store.state.chats.c1 = { chatID: 'c1', title: 'Sam', network: 'WhatsApp', type: 'single', allowed: true, mode: 'default', instructions: '' }
  const sent: Array<{ chatID: string; text: string }> = []
  const history: HistoryMessage[] = []
  const beeper = {
    hasToken: true,
    history: async () => history.slice(),
    send: async (chatID: string, text: string) => { sent.push({ chatID, text }); return { pendingMessageID: 'p' } },
    typing: async () => undefined,
    getChat: async () => null,
    listChats: async () => [],
  } as unknown as Beeper
  const timers: Array<() => void> = []
  let t = Date.parse('2026-11-25T15:00:10Z')
  const engine = new Engine({
    store,
    beeper,
    complete: async () => 'sounds good!',
    now: () => t,
    setTimer: (fn) => { timers.push(fn); return setTimeout(() => undefined, 0) },
  })
  const flush = async () => { while (timers.length) { timers.shift()!(); await new Promise(r => setImmediate(r)) } }
  const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({ id: `m${Math.random()}`, chatID: 'c1', isSender: false, text: 'are we still on?', type: 'TEXT', timestamp: '2026-11-25T15:00:00Z', ...over })
  return { store, engine, sent, history, flush, msg, advance: (ms: number) => { t += ms } }
}

test('approve mode: creates a pending draft and notifies note-to-self, sends only on approval', async () => {
  const s = setup('approve')
  await s.engine.onMessage(s.msg())
  await s.flush()
  const pending = s.store.state.drafts.filter(d => d.status === 'pending')
  assert.equal(pending.length, 1)
  assert.equal(s.sent.filter(x => x.chatID === 'c1').length, 0)
  assert.ok(s.sent.some(x => x.chatID === 'nts' && x.text.includes(`ok ${pending[0]!.id}`)))
  await s.engine.onMessage({ id: 'cmd1', chatID: 'nts', isSender: true, text: `edit ${pending[0]!.id} yes 7pm!`, type: 'TEXT', timestamp: '2026-11-25T15:00:05Z' })
  assert.deepEqual(s.sent.find(x => x.chatID === 'c1'), { chatID: 'c1', text: 'yes 7pm!' })
  assert.equal(s.store.state.drafts[0]!.status, 'sent')
})

test('auto mode: sends after delay; bot echo does not cancel', async () => {
  const s = setup('auto')
  await s.engine.onMessage(s.msg())
  await s.flush()
  assert.deepEqual(s.sent.filter(x => x.chatID === 'c1').map(x => x.text), ['sounds good!'])
  // the echo of our own sent message must not be treated as a manual reply
  await s.engine.onMessage(s.msg({ isSender: true, text: 'sounds good!' }))
  assert.equal(s.store.state.drafts[0]!.status, 'sent')
})

test('manual owner reply supersedes pending drafts', async () => {
  const s = setup('approve')
  await s.engine.onMessage(s.msg())
  await s.flush()
  await s.engine.onMessage(s.msg({ isSender: true, text: 'typed by hand' }))
  assert.equal(s.store.state.drafts[0]!.status, 'superseded')
})

test('auto mode respects rate limit by holding for approval', async () => {
  const s = setup('auto')
  s.store.state.settings.rateLimits.minGapSecondsPerChat = 3600
  await s.engine.onMessage(s.msg())
  await s.flush()
  s.advance(1000)
  await s.engine.onMessage(s.msg({ text: 'and another' }))
  await s.flush()
  const last = s.store.state.drafts.at(-1)!
  assert.equal(last.status, 'pending')
  assert.match(last.reason, /held for approval/)
})

test('API rejects wrong key and serves status with right key; api key is redacted', async () => {
  const s = setup('approve')
  s.store.state.settings.provider.apiKey = 'sk-secret-1234'
  const server = createApi({ store: s.store, beeper: { hasToken: true } as unknown as Beeper, engine: s.engine, secret: 'super-secret-key', status: () => ({ ok: 1 }), onSignedIn: () => undefined })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`
  assert.equal((await fetch(`${base}/api/ping`)).status, 200)
  assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: 'Bearer nope' } })).status, 401)
  const ok = await fetch(`${base}/api/settings`, { headers: { Authorization: 'Bearer super-secret-key' } })
  const body = await ok.json() as { settings: { provider: { apiKey: string } } }
  assert.equal(body.settings.provider.apiKey, '••••••1234')
  const put = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { Authorization: 'Bearer super-secret-key' }, body: JSON.stringify({ provider: { apiKey: '••••••1234', model: 'x' } }) })
  assert.equal(put.status, 200)
  assert.equal(s.store.state.settings.provider.apiKey, 'sk-secret-1234')
  assert.equal(s.store.state.settings.provider.model, 'x')
  server.close()
})
