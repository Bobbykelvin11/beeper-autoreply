import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultSettings, mergeSettings } from '../src/defaults.js'
import { RateLimiter, buildPrompt, cleanReply, decide, humanDelayMs, isQuietTime, parseNoteCommand, SKIP_TOKEN } from '../src/policy.js'
import type { ChatSettings, IncomingMessage } from '../src/types.js'

const chat = (over: Partial<ChatSettings> = {}): ChatSettings => ({ chatID: 'c1', title: 'Sam', network: 'WhatsApp', type: 'single', allowed: true, mode: 'default', instructions: '', ...over })
const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({ id: 'm1', chatID: 'c1', isSender: false, text: 'hi', type: 'TEXT', timestamp: new Date('2026-11-25T15:00:00Z').toISOString(), ...over })
const now = new Date('2026-11-25T15:00:30Z')
const on = () => mergeSettings(defaultSettings({}), { enabled: true })

test('bot off ignores everything', () => {
  const d = decide({ settings: defaultSettings({}), chat: chat(), message: msg(), noteToSelfChatID: '', now })
  assert.equal(d.action, 'ignore')
})

test('default mode is approve-before-send', () => {
  const d = decide({ settings: on(), chat: chat(), message: msg(), noteToSelfChatID: '', now })
  assert.deepEqual(d.action === 'reply' && d.mode, 'approve')
})

test('per-chat auto overrides default', () => {
  const d = decide({ settings: on(), chat: chat({ mode: 'auto' }), message: msg(), noteToSelfChatID: '', now })
  assert.equal(d.action === 'reply' && d.mode, 'auto')
})

test('global auto with per-chat approve stays approve', () => {
  const s = mergeSettings(on(), { defaultMode: 'auto' })
  const d = decide({ settings: s, chat: chat({ mode: 'approve' }), message: msg(), noteToSelfChatID: '', now })
  assert.equal(d.action === 'reply' && d.mode, 'approve')
})

test('allowlist, groups, own, old and non-text messages are ignored', () => {
  const s = on()
  assert.equal(decide({ settings: s, chat: chat({ allowed: false }), message: msg(), noteToSelfChatID: '', now }).action, 'ignore')
  assert.equal(decide({ settings: s, chat: chat({ type: 'group' }), message: msg(), noteToSelfChatID: '', now }).action, 'ignore')
  assert.equal(decide({ settings: s, chat: chat(), message: msg({ isSender: true }), noteToSelfChatID: '', now }).action, 'ignore')
  assert.equal(decide({ settings: s, chat: chat(), message: msg({ type: 'IMAGE' }), noteToSelfChatID: '', now }).action, 'ignore')
  assert.equal(decide({ settings: s, chat: chat(), message: msg({ timestamp: '2026-11-25T14:00:00Z' }), noteToSelfChatID: '', now }).action, 'ignore')
  assert.equal(decide({ settings: s, chat: chat(), message: msg(), noteToSelfChatID: 'c1', now }).action, 'ignore')
})

test('allowAllDirectChats allows unlisted direct chats but not groups', () => {
  const s = mergeSettings(on(), { allowAllDirectChats: true })
  assert.equal(decide({ settings: s, chat: chat({ allowed: false }), message: msg(), noteToSelfChatID: '', now }).action, 'reply')
  assert.equal(decide({ settings: s, chat: chat({ allowed: false, type: 'group' }), message: msg(), noteToSelfChatID: '', now }).action, 'ignore')
})

test('quiet hours across midnight hold auto replies for approval', () => {
  const s = mergeSettings(on(), { quietHours: { enabled: true, start: '22:00', end: '07:00', timeZone: 'UTC' } })
  assert.equal(isQuietTime(s, new Date('2026-11-25T23:30:00Z')), true)
  assert.equal(isQuietTime(s, new Date('2026-11-25T06:59:00Z')), true)
  assert.equal(isQuietTime(s, new Date('2026-11-25T12:00:00Z')), false)
  const late = new Date('2026-11-25T23:30:10Z')
  const d = decide({ settings: s, chat: chat({ mode: 'auto' }), message: msg({ timestamp: '2026-11-25T23:30:00Z' }), noteToSelfChatID: '', now: late })
  assert.equal(d.action === 'reply' && d.mode, 'approve')
  const skip = mergeSettings(s, { quietHours: { behavior: 'skip' } })
  assert.equal(decide({ settings: skip, chat: chat({ mode: 'auto' }), message: msg({ timestamp: '2026-11-25T23:30:00Z' }), noteToSelfChatID: '', now: late }).action, 'ignore')
})

test('rate limiter enforces gap, per chat and global limits', () => {
  let t = 0
  const rl = new RateLimiter(() => t)
  const limits = { perChatPerHour: 2, globalPerHour: 3, minGapSecondsPerChat: 60 }
  assert.equal(rl.check('a', limits), null)
  rl.record('a')
  assert.match(rl.check('a', limits) ?? '', /min gap/)
  t += 61_000
  rl.record('a')
  t += 61_000
  assert.match(rl.check('a', limits) ?? '', /chat limit/)
  rl.record('b')
  assert.match(rl.check('c', limits) ?? '', /global limit/)
  t += 3600_000
  assert.equal(rl.check('a', limits), null)
})

test('human delay stays within bounds', () => {
  const s = mergeSettings(on(), { delay: { minSeconds: 10, maxSeconds: 20 } })
  assert.equal(humanDelayMs(s, '', () => 0), 10_000)
  assert.equal(humanDelayMs(s, '', () => 1), 20_000)
})

test('cleanReply strips quotes/think and honors skip + tag', () => {
  const s = on()
  assert.equal(cleanReply('<think>hmm</think> "sure, see you!"', s), 'sure, see you!')
  assert.equal(cleanReply(SKIP_TOKEN, s), null)
  assert.equal(cleanReply('Me: ok', s), 'ok')
  assert.equal(cleanReply('ok', mergeSettings(s, { addAutoTag: true })), 'ok (auto-reply)')
})

test('buildPrompt maps roles and merges consecutive turns', () => {
  const p = buildPrompt({ settings: on(), chat: chat(), history: [
    { id: '1', isSender: false, text: 'yo', timestamp: '', sortKey: '1' },
    { id: '2', isSender: false, text: 'u there?', timestamp: '', sortKey: '2' },
    { id: '3', isSender: true, text: 'yes', timestamp: '', sortKey: '3' },
    { id: '4', isSender: false, text: 'cool', timestamp: '', sortKey: '4' },
  ] })
  assert.deepEqual(p.map(m => m.role), ['system', 'user', 'assistant', 'user'])
  assert.equal(p[1]!.content, 'yo\nu there?')
  assert.match(p[0]!.content, /SKIP/)
})

test('parseNoteCommand', () => {
  assert.deepEqual(parseNoteCommand('ok ab12'), { kind: 'send', id: 'ab12' })
  assert.deepEqual(parseNoteCommand('edit #AB12 see you at 5'), { kind: 'send', id: 'ab12', text: 'see you at 5' })
  assert.deepEqual(parseNoteCommand('no ab12'), { kind: 'reject', id: 'ab12' })
  assert.deepEqual(parseNoteCommand('bot off'), { kind: 'mode', mode: 'off' })
  assert.equal(parseNoteCommand('ok'), null)
  assert.equal(parseNoteCommand('hello there'), null)
})

test('mergeSettings ignores unknown keys and wrong types', () => {
  const s = mergeSettings(defaultSettings({}), { enabled: 'yes', evil: 1, rateLimits: { globalPerHour: '12' }, defaultMode: 'auto' })
  assert.equal(s.enabled, false)
  assert.equal((s as unknown as Record<string, unknown>).evil, undefined)
  assert.equal(s.rateLimits.globalPerHour, 12)
  assert.equal(s.defaultMode, 'auto')
})
