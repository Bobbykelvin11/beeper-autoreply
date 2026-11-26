import { createServer, type IncomingMessage as Req, type Server, type ServerResponse } from 'node:http'
import { PROVIDER_PRESETS, chatCompletion } from './ai.js'
import type { Beeper } from './beeper.js'
import { mergeSettings } from './defaults.js'
import { errMsg, type Engine } from './engine.js'
import { LoginManager } from './logins.js'
import { buildPrompt, cleanReply } from './policy.js'
import { safeEqual } from './rendezvous.js'
import type { Store } from './store.js'

export const VERSION = '1.0.0'

export interface ApiDeps {
  store: Store
  beeper: Beeper
  engine: Engine
  secret: string
  status: () => Record<string, unknown>
  onSignedIn: (token: string) => void
}

type Handler = (ctx: { req: Req; body: Record<string, unknown>; params: string[]; url: URL }) => Promise<unknown> | unknown

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Redacts the provider API key before settings leave the server. */
export function publicSettings(store: Store): Record<string, unknown> {
  const s = store.state.settings
  return { ...s, provider: { ...s.provider, apiKey: s.provider.apiKey ? '••••••' + s.provider.apiKey.slice(-4) : '' } }
}

export function createApi(deps: ApiDeps): Server {
  const { store, beeper, engine } = deps
  const logins = new LoginManager(beeper)
  const failures = new Map<string, { count: number; until: number }>()
  const routes: Array<[string, RegExp, Handler]> = []
  const route = (method: string, pattern: string, handler: Handler) => {
    routes.push([method, new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, '([^/]+)') + '$'), handler])
  }

  route('GET', '/api/status', () => deps.status())
  route('GET', '/api/settings', () => ({ settings: publicSettings(store), presets: PROVIDER_PRESETS }))
  route('PUT', '/api/settings', ({ body }) => {
    const patch = (body.settings ?? body) as Record<string, unknown>
    const provider = patch.provider as Record<string, unknown> | undefined
    // keep the stored key when the page sends back the redacted placeholder
    if (provider && typeof provider.apiKey === 'string' && provider.apiKey.startsWith('••••')) delete provider.apiKey
    const wasEnabled = store.state.settings.enabled
    store.state.settings = mergeSettings(store.state.settings, patch)
    if (wasEnabled && !store.state.settings.enabled) engine.cancelAll('bot turned off')
    store.log('info', 'Settings updated')
    store.scheduleSave()
    return { settings: publicSettings(store) }
  })

  route('GET', '/api/chats', async ({ url }) => {
    if (url.searchParams.get('refresh') === '1' && beeper.hasToken) await engine.refreshChats()
    const chats = Object.values(store.state.chats).sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.title.localeCompare(b.title))
    return { chats, noteToSelfChatID: engine.noteToSelfChatID }
  })
  route('PUT', '/api/chats/:id', ({ params, body }) => ({ chat: engine.updateChat(decodeURIComponent(params[0]!), body as never) }))

  route('GET', '/api/drafts', ({ url }) => {
    store.pruneDrafts()
    const all = url.searchParams.get('all') === '1'
    const drafts = store.state.drafts.filter(d => all || d.status === 'pending').slice().reverse().slice(0, 100)
    return { drafts }
  })
  route('POST', '/api/drafts/:id/send', async ({ params, body }) => ({ draft: await engine.sendDraft(params[0]!, typeof body.text === 'string' ? body.text : undefined) }))
  route('POST', '/api/drafts/:id/reject', ({ params }) => ({ draft: engine.rejectDraft(params[0]!) }))

  route('GET', '/api/logs', () => ({ logs: store.state.logs.slice(-200).reverse() }))

  route('POST', '/api/test-ai', async ({ body }) => {
    const text = String(body.text ?? 'hey, how are you?')
    const settings = store.state.settings
    const raw = await chatCompletion(settings.provider, buildPrompt({ settings, chat: undefined, history: [{ id: 't', isSender: false, text, timestamp: new Date().toISOString(), sortKey: '1' }] }))
    return { raw, reply: cleanReply(raw, settings) }
  })

  // ---- Beeper sign-in & verification --------------------------------------------
  route('GET', '/api/link/state', async () => ({ state: await beeper.state(), signedIn: beeper.hasToken }))
  route('POST', '/api/link/email', async ({ body }) => {
    const email = String(body.email ?? '').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email')
    return beeper.emailStart(email)
  })
  route('POST', '/api/link/code', async ({ body }) => {
    const setupRequestID = String(body.setupRequestID ?? '')
    const code = String(body.code ?? '').trim()
    if (!setupRequestID || !code) throw new HttpError(400, 'Missing code')
    const username = typeof body.username === 'string' && body.username.trim() ? { username: body.username.trim() } : undefined
    if (username && body.acceptTerms !== true) throw new HttpError(400, 'You must accept the Beeper terms to create an account')
    const out = await beeper.emailCode(setupRequestID, code, username)
    if (out.token) {
      deps.onSignedIn(out.token)
      return { ok: true, session: out.session }
    }
    return { ok: false, registrationRequired: out.registrationRequired }
  })
  route('POST', '/api/link/verify', async () => ({ session: await beeper.verifyStart() }))
  route('POST', '/api/link/verify/:id/:action', async ({ params }) => {
    const action = params[1] as 'accept' | 'sas.start' | 'sas.confirm' | 'cancel'
    if (!['accept', 'sas.start', 'sas.confirm', 'cancel'].includes(action)) throw new HttpError(400, 'Unknown action')
    return { session: await beeper.verifyAction(decodeURIComponent(params[0]!), action) }
  })
  route('POST', '/api/link/recovery-key', async ({ body }) => {
    const key = String(body.recoveryKey ?? '').trim()
    if (!key) throw new HttpError(400, 'Missing recovery key')
    return { session: await beeper.recoveryKey(key) }
  })

  // ---- chat networks (WhatsApp, Telegram, ...) -----------------------------------
  route('GET', '/api/accounts', async () => ({ accounts: await beeper.accounts() }))
  route('GET', '/api/bridges', async () => ({ bridges: await beeper.bridges() }))
  route('GET', '/api/bridges/:id/flows', async ({ params }) => ({ flows: await beeper.loginFlows(decodeURIComponent(params[0]!)) }))
  route('POST', '/api/bridges/:id/login', async ({ params, body }) => ({ session: await logins.start(decodeURIComponent(params[0]!), typeof body.flowID === 'string' ? body.flowID : undefined) }))
  route('GET', '/api/bridges/:id/login/:sid', async ({ params }) => ({ session: await logins.get(decodeURIComponent(params[0]!), decodeURIComponent(params[1]!)) }))
  route('POST', '/api/bridges/:id/login/:sid/steps/:step', async ({ params, body }) => {
    const type = String(body.type ?? 'user_input') as 'user_input' | 'cookies' | 'display_and_wait'
    const fields = (typeof body.fields === 'object' && body.fields ? body.fields : undefined) as Record<string, string> | undefined
    return { session: await logins.submit(decodeURIComponent(params[0]!), decodeURIComponent(params[1]!), decodeURIComponent(params[2]!), type, fields) }
  })
  route('DELETE', '/api/bridges/:id/login/:sid', async ({ params }) => ({ result: await logins.cancel(decodeURIComponent(params[0]!), decodeURIComponent(params[1]!)) }))

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (url.pathname === '/api/ping') return send(res, 200, { ok: true, app: 'beeper-autoreply', version: VERSION })

    const ip = String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '')
    const f = failures.get(ip)
    if (f && f.until > Date.now()) return send(res, 429, { error: 'Too many wrong keys. Try again later.' })
    const auth = String(req.headers.authorization ?? '')
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), deps.secret)) {
      const count = (f?.count ?? 0) + 1
      failures.set(ip, { count, until: count >= 5 ? Date.now() + 10 * 60_000 : 0 })
      return send(res, 401, { error: 'Wrong access key' })
    }
    failures.delete(ip)

    for (const [method, re, handler] of routes) {
      if (req.method !== method) continue
      const m = re.exec(url.pathname)
      if (!m) continue
      try {
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req)
        const out = await handler({ req, body, params: m.slice(1), url })
        return send(res, 200, out ?? { ok: true })
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500
        return send(res, status, { error: errMsg(err) })
      }
    }
    return send(res, 404, { error: 'Not found' })
  })
}

async function readBody(req: Req): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 256 * 1024) throw new HttpError(413, 'Body too large')
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
