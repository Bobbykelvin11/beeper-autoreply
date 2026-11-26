import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { latestFromNtfy, openURL, rendezvousTopic } from './rendezvous.ts'
import { seal, unseal } from './session.ts'

// Same sealing as the server (server/src/rendezvous.ts) to prove both sides agree.
function sealURL(secret: string, url: string, ts: number): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', createHash('sha256').update(`beeper-autoreply/key/${secret}`).digest(), iv)
  const ct = Buffer.concat([c.update(JSON.stringify({ url, ts }), 'utf8'), c.final()])
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64url')
}

test('topic matches server format', () => {
  assert.match(rendezvousTopic('abc'), /^bar[0-9a-f]{40}$/)
})

test('picks newest decryptable URL from ntfy output', () => {
  const secret = 'my long secret'
  const lines = [
    JSON.stringify({ event: 'open' }),
    JSON.stringify({ event: 'message', message: sealURL(secret, 'https://old.trycloudflare.com', 1) }),
    JSON.stringify({ event: 'message', message: sealURL('other', 'https://evil.example', 9) }),
    JSON.stringify({ event: 'message', message: sealURL(secret, 'https://new.trycloudflare.com', 5) }),
  ].join('\n')
  assert.equal(latestFromNtfy(secret, lines), 'https://new.trycloudflare.com')
  assert.equal(openURL(secret, 'garbage'), null)
})

test('session cookie round trip and expiry', () => {
  const token = seal({ secret: 's', vmURL: 'https://x' }, 0)
  assert.equal(unseal(token, 1)?.vmURL, 'https://x')
  assert.equal(unseal(token, Date.now() + 1e12), null)
  assert.equal(unseal('nope'), null)
})
