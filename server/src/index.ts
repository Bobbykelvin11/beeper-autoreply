import { Beeper, cliToken, resolveBaseURL } from './beeper.js'
import { createApi, VERSION } from './api.js'
import { Engine, errMsg } from './engine.js'
import { discoverQuickTunnel, publishURL } from './rendezvous.js'
import { Store } from './store.js'

const env = process.env
const secret = env.CONTROL_SECRET ?? ''
if (secret.length < 12) {
  console.error('CONTROL_SECRET must be set to at least 12 characters (see /etc/beeper-autoreply.env).')
  process.exit(1)
}

const store = new Store(env.DATA_DIR || './data')
const beeper = new Beeper(resolveBaseURL(env), store.secrets.beeperAccessToken || cliToken(env))
const engine = new Engine({ store, beeper })
let wsStatus = 'starting'
let publicURL = env.PUBLIC_URL || ''

const server = createApi({
  store,
  beeper,
  engine,
  secret,
  status: () => ({
    version: VERSION,
    enabled: store.state.settings.enabled,
    defaultMode: store.state.settings.defaultMode,
    beeperBaseURL: beeper.baseURL,
    signedIn: beeper.hasToken,
    events: wsStatus,
    publicURL,
    pendingDrafts: store.state.drafts.filter(d => d.status === 'pending').length,
    allowedChats: Object.values(store.state.chats).filter(c => c.allowed).length,
    noteToSelfChatID: engine.noteToSelfChatID,
    provider: { baseURL: store.state.settings.provider.baseURL, model: store.state.settings.provider.model, hasKey: !!store.state.settings.provider.apiKey },
  }),
  onSignedIn: token => {
    store.setSecrets({ beeperAccessToken: token })
    store.log('info', 'Signed in to Beeper')
    void engine.refreshChats().catch(() => undefined)
  },
})

const port = Number(env.PORT || 8787)
server.listen(port, env.HOST || '127.0.0.1', () => store.log('info', `Control API listening on ${env.HOST || '127.0.0.1'}:${port}`))

const stopWatch = beeper.watch(
  m => void engine.onMessage(m).catch(err => store.log('error', `Event handling failed: ${errMsg(err)}`, m.chatID)),
  s => {
    if (s !== wsStatus) store.log(s === 'connected' ? 'info' : 'warn', `Beeper events: ${s}`)
    wsStatus = s
  },
)

// Keep chat list fresh and drafts tidy.
const refresh = async () => {
  if (!beeper.hasToken) return
  try {
    await engine.refreshChats()
  } catch (err) {
    store.log('warn', `Chat refresh failed: ${errMsg(err)}`)
  }
  store.pruneDrafts()
}
setTimeout(refresh, 5_000)
setInterval(refresh, 10 * 60_000)

// Rendezvous: publish the current tunnel URL (encrypted) so the control page can find it.
const ntfy = env.NTFY_URL ?? 'https://ntfy.sh'
let lastPublished = ''
let lastPublishAt = 0
const rendezvous = async () => {
  const url = env.PUBLIC_URL || (await discoverQuickTunnel(env.CLOUDFLARED_METRICS || '127.0.0.1:20241')) || ''
  if (!url) return
  const changed = url !== publicURL
  publicURL = url
  if (ntfy === 'off') return
  if (url === lastPublished && Date.now() - lastPublishAt < 3 * 3600_000) return
  try {
    await publishURL(ntfy, secret, url)
    lastPublished = url
    lastPublishAt = Date.now()
    if (changed) {
      store.log('info', `Control URL is ${url}`)
      await engine.notify(`Your auto-reply server address changed. Open your control page and it will reconnect automatically.`)
    }
  } catch (err) {
    store.log('warn', `Could not publish control URL: ${errMsg(err)}`)
  }
}
setTimeout(rendezvous, 3_000)
setInterval(rendezvous, 60_000)

const shutdown = () => {
  stopWatch()
  store.saveNow()
  server.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
