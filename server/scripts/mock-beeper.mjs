// Dev-only mock of the Beeper Server API + an OpenAI-compatible AI, for local end-to-end testing.
// Usage: node scripts/mock-beeper.mjs  (Beeper on :23999, AI on :23998)
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const chats = [
  { id: '!sam:local-whatsapp', accountID: 'wa', network: 'WhatsApp', title: 'Sam', type: 'single', unreadCount: 0, participants: { hasMore: false, total: 2, items: [{ id: 'me', isSelf: true }, { id: 'sam' }] } },
  { id: '!nts:beeper', accountID: 'matrix', network: 'Beeper', title: 'Note to self', type: 'single', unreadCount: 0, participants: { hasMore: false, total: 1, items: [{ id: 'me', isSelf: true }] } },
]
const messages = { '!sam:local-whatsapp': [], '!nts:beeper': [] }
let state = 'needs-login'
let n = 0
const sockets = new Set()

function emit(chatID, msg) {
  for (const ws of sockets) ws.send(JSON.stringify({ type: 'message.upserted', seq: ++n, ts: Date.now(), chatID, ids: [msg.id], entries: [msg] }))
}
function addMessage(chatID, text, isSender) {
  const msg = { id: `m${++n}`, chatID, accountID: 'x', senderID: isSender ? 'me' : 'sam', senderName: isSender ? 'Me' : 'Sam', sortKey: String(Date.now() * 1000 + n), timestamp: new Date().toISOString(), text, type: 'TEXT', isSender }
  messages[chatID].push(msg)
  emit(chatID, msg)
  return msg
}
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
const body = req => new Promise(r => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => r(d ? JSON.parse(d) : {})) })

const beeper = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  const b = req.method === 'POST' ? await body(req) : {}
  if (p === '/v1/app/setup' && req.method === 'GET') return json(res, 200, { state, e2ee: {}, matrix: state === 'needs-login' ? undefined : { userID: '@me:beeper.com', deviceID: 'D', homeserver: 'x' } })
  if (p === '/v1/app/setup/start') return json(res, 200, { setupRequestID: 'req1' })
  if (p === '/v1/app/setup/email') { res.writeHead(204); return res.end() }
  if (p === '/v1/app/setup/response') { state = 'ready'; return json(res, 200, { matrix: { accessToken: 'tok123', deviceID: 'D', homeserver: 'x', userID: '@me:beeper.com' }, session: { state } }) }
  if (p === '/v1/chats' && req.method === 'GET') return json(res, 200, { items: chats, hasMore: false, oldestCursor: null, newestCursor: null })
  let m = /^\/v1\/chats\/([^/]+)$/.exec(p)
  if (m) return json(res, 200, chats.find(c => c.id === decodeURIComponent(m[1])) ?? {})
  m = /^\/v1\/chats\/([^/]+)\/messages$/.exec(p)
  if (m && req.method === 'GET') return json(res, 200, { items: messages[decodeURIComponent(m[1])].slice().reverse(), hasMore: false, oldestCursor: null, newestCursor: null })
  if (m && req.method === 'POST') { const msg = addMessage(decodeURIComponent(m[1]), b.text, true); console.log(`[mock] SENT to ${m[1]}: ${b.text}`); return json(res, 200, { chatID: m[1], pendingMessageID: msg.id }) }
  if (p === '/v1/bridges') return json(res, 200, { items: [{ id: 'local-whatsapp', displayName: 'WhatsApp', provider: 'local', status: 'available', activeAccountCount: 0, supportsMultipleAccounts: true, type: 'whatsapp', accounts: [] }] })
  if (p === '/mock/incoming') { addMessage(url.searchParams.get('chat') || '!sam:local-whatsapp', url.searchParams.get('text') || 'hey!', url.searchParams.get('me') === '1'); return json(res, 200, { ok: true }) }
  if (p.endsWith('/typing')) return json(res, 200, {})
  json(res, 404, { error: 'mock: not found ' + p })
})
const wss = new WebSocketServer({ noServer: true })
beeper.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, ws => { sockets.add(ws); ws.on('close', () => sockets.delete(ws)); ws.send(JSON.stringify({ type: 'ready', version: 1, chatIDs: [] })) }))
beeper.listen(23999, () => console.log('mock beeper on :23999'))

createServer(async (req, res) => {
  const b = await body(req)
  const last = b.messages?.at(-1)?.content ?? ''
  json(res, 200, { choices: [{ message: { content: `<think>x</think>"Got it: ${String(last).slice(0, 40)}"` } }] })
}).listen(23998, () => console.log('mock AI on :23998'))
