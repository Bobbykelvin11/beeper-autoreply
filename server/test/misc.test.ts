import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareSortKey, parseEvent } from '../src/beeper.js'
import { openURL, rendezvousTopic, sealURL } from '../src/rendezvous.js'
import { chatCompletion } from '../src/ai.js'

test('rendezvous seal/open round trip and wrong key fails', () => {
  const sealed = sealURL('correct horse battery', 'https://abc.trycloudflare.com', 42)
  assert.deepEqual(openURL('correct horse battery', sealed), { url: 'https://abc.trycloudflare.com', ts: 42 })
  assert.equal(openURL('wrong secret here', sealed), null)
  assert.match(rendezvousTopic('x'), /^bar[0-9a-f]{40}$/)
})

test('parseEvent extracts message.upserted entries', () => {
  const frame = JSON.stringify({ type: 'message.upserted', seq: 1, ts: 1, chatID: 'c1', ids: ['m1'], entries: [{ id: 'm1', text: 'hey', isSender: false, type: 'TEXT', timestamp: '2026-01-01T00:00:00Z' }] })
  const out = parseEvent(frame)
  assert.equal(out.length, 1)
  assert.equal(out[0]!.chatID, 'c1')
  assert.equal(out[0]!.text, 'hey')
  assert.deepEqual(parseEvent('{"type":"chat.upserted"}'), [])
  assert.deepEqual(parseEvent('not json'), [])
})

test('compareSortKey handles big numeric keys', () => {
  assert.equal(compareSortKey('99999999999999999999', '100000000000000000000'), -1)
  assert.equal(compareSortKey('b', 'a'), 1)
})

test('chatCompletion posts OpenAI-compatible request', async () => {
  let seen: { url: string; body: Record<string, unknown>; auth?: string } | undefined
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'hello!' } }] }), { status: 200 })
  }) as unknown as typeof fetch
  const out = await chatCompletion({ baseURL: 'https://api.example.com/v1/', apiKey: 'k', model: 'm', temperature: 0.5 }, [{ role: 'user', content: 'hi' }], fake)
  assert.equal(out, 'hello!')
  assert.equal(seen?.url, 'https://api.example.com/v1/chat/completions')
  assert.equal(seen?.auth, 'Bearer k')
  assert.equal(seen?.body.model, 'm')
})
