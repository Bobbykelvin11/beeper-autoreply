import type { Beeper } from './beeper.js'
import { errMsg } from './engine.js'

interface SessionLike {
  loginSessionID?: string
  status?: string
  currentStep?: { type?: string; stepID?: string }
}

interface Tracked {
  bridgeID: string
  session: SessionLike
  waiting: boolean
  error?: string
  updatedAt: number
}

/**
 * Network sign-in sessions (WhatsApp pairing code, Telegram code, ...).
 * "display_and_wait" steps block until the user finishes on their phone, which is longer than an
 * HTTP request through Vercel + a tunnel can stay open, so we wait in the background and let the
 * control page poll for the latest state.
 */
export class LoginManager {
  private sessions = new Map<string, Tracked>()

  constructor(private readonly beeper: Beeper) {}

  async start(bridgeID: string, flowID?: string): Promise<unknown> {
    const session = (await this.beeper.loginStart(bridgeID, flowID)) as SessionLike
    return this.track(bridgeID, session)
  }

  async submit(bridgeID: string, sid: string, stepID: string, type: 'user_input' | 'cookies' | 'display_and_wait', fields?: Record<string, string>): Promise<unknown> {
    const session = (await this.beeper.loginSubmit(bridgeID, sid, stepID, type, fields)) as SessionLike
    return this.track(bridgeID, session)
  }

  async get(bridgeID: string, sid: string): Promise<unknown> {
    const t = this.sessions.get(sid)
    if (t) return this.view(t)
    const session = (await this.beeper.loginGet(bridgeID, sid)) as SessionLike
    return this.track(bridgeID, session)
  }

  async cancel(bridgeID: string, sid: string): Promise<unknown> {
    this.sessions.delete(sid)
    return this.beeper.loginCancel(bridgeID, sid)
  }

  private track(bridgeID: string, session: SessionLike): unknown {
    const sid = session.loginSessionID
    if (!sid) return session
    const t: Tracked = this.sessions.get(sid) ?? { bridgeID, session, waiting: false, updatedAt: Date.now() }
    t.session = session
    t.updatedAt = Date.now()
    t.error = undefined
    this.sessions.set(sid, t)
    this.maybeWait(t)
    this.gc()
    return this.view(t)
  }

  private maybeWait(t: Tracked): void {
    const step = t.session.currentStep
    if (t.waiting || step?.type !== 'display_and_wait' || !step.stepID || !t.session.loginSessionID) return
    t.waiting = true
    const sid = t.session.loginSessionID
    void this.beeper
      .loginSubmit(t.bridgeID, sid, step.stepID, 'display_and_wait')
      .then(next => {
        t.waiting = false
        t.session = next as SessionLike
        t.updatedAt = Date.now()
        this.maybeWait(t)
      })
      .catch(err => {
        t.waiting = false
        t.error = errMsg(err)
        t.updatedAt = Date.now()
      })
  }

  private view(t: Tracked): unknown {
    return { ...t.session, waiting: t.waiting, error: t.error ? { message: t.error } : (t.session as { error?: unknown }).error }
  }

  private gc(): void {
    const cutoff = Date.now() - 30 * 60_000
    for (const [sid, t] of this.sessions) if (t.updatedAt < cutoff) this.sessions.delete(sid)
  }
}
