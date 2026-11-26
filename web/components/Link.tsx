'use client'
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '@/lib/client'
import { Card, ErrorNote } from './ui'

interface Verification {
  id: string
  availableActions: string[]
  direction: string
  state: string
  otherDevice?: { name?: string }
  sas?: { emojis: string; decimals?: string }
  error?: { reason: string }
}
interface AppState {
  state: string
  matrix?: { userID: string }
  verification?: Verification
}

export function Link() {
  return (
    <>
      <h1>Link</h1>
      <BeeperAccount />
      <Networks />
    </>
  )
}

function BeeperAccount() {
  const [st, setSt] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [reqID, setReqID] = useState<string | null>(null)
  const [needsUsername, setNeedsUsername] = useState<string[] | null>(null)
  const [username, setUsername] = useState('')
  const [terms, setTerms] = useState(false)
  const [recovery, setRecovery] = useState('')
  const [showRecovery, setShowRecovery] = useState(false)

  const load = useCallback(() => api<{ state: AppState }>('link/state').then(d => setSt(d.state)).catch(e => setError(e.message)), [])
  useEffect(() => {
    load()
    const t = setInterval(load, 3_000)
    return () => clearInterval(t)
  }, [load])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const state = st?.state
  const v = st?.verification
  const actions = new Set(v?.availableActions ?? [])

  return (
    <Card title="1 · Beeper account" right={state === 'ready' ? <span className="pill sent">linked</span> : undefined}>
      {!st && <p className="muted">Checking…</p>}
      {state === 'needs-login' && !reqID && (
        <form onSubmit={e => { e.preventDefault(); run(async () => setReqID((await api<{ setupRequestID: string }>('link/email', 'POST', { email })).setupRequestID)) }}>
          <p className="muted">Enter your Beeper email. Beeper will email you a code.</p>
          <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="primary" disabled={busy || !email}>Send code</button>
        </form>
      )}
      {state === 'needs-login' && reqID && !needsUsername && (
        <form onSubmit={e => {
          e.preventDefault()
          run(async () => {
            const r = await api<{ ok: boolean; registrationRequired?: { usernameSuggestions?: string[] } }>('link/code', 'POST', { setupRequestID: reqID, code })
            if (!r.ok) setNeedsUsername(r.registrationRequired?.usernameSuggestions ?? [])
          })
        }}>
          <p className="muted">Type the code from the Beeper email sent to {email}.</p>
          <input inputMode="numeric" autoComplete="one-time-code" placeholder="Code" value={code} onChange={e => setCode(e.target.value)} />
          <button className="primary" disabled={busy || !code}>Sign in</button>
          <button type="button" className="link" onClick={() => { setReqID(null); setCode('') }}>Use a different email</button>
        </form>
      )}
      {needsUsername && (
        <form onSubmit={e => { e.preventDefault(); run(() => api('link/code', 'POST', { setupRequestID: reqID, code, username, acceptTerms: terms })) }}>
          <p className="muted">That email has no Beeper account yet. Pick a username to create one.</p>
          <input placeholder={needsUsername[0] ?? 'username'} value={username} onChange={e => setUsername(e.target.value)} />
          <label className="check"><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} /> I accept the <a href="https://www.beeper.com/terms" target="_blank" rel="noreferrer">Beeper terms</a></label>
          <button className="primary" disabled={busy || !username || !terms}>Create account</button>
        </form>
      )}
      {state && state !== 'needs-login' && state !== 'ready' && (
        <div>
          <p className="muted">Signed in{st?.matrix?.userID ? ` as ${st.matrix.userID}` : ''}. Now confirm this server from the Beeper app on your iPhone.</p>
          {!v && <button className="primary wide" disabled={busy} onClick={() => run(() => api('link/verify', 'POST'))}>Start verification</button>}
          {v && (
            <div className="verify">
              <p>Verification: <strong>{v.state}</strong>{v.otherDevice?.name ? ` with ${v.otherDevice.name}` : ''}</p>
              {v.state === 'requested' && v.direction === 'outgoing' && <p className="muted">Open Beeper on your iPhone and accept the verification request.</p>}
              {actions.has('accept') && <button className="primary wide" disabled={busy} onClick={() => run(() => api(`link/verify/${encodeURIComponent(v.id)}/accept`, 'POST'))}>Accept request</button>}
              {actions.has('sas.start') && <button className="primary wide" disabled={busy} onClick={() => run(() => api(`link/verify/${encodeURIComponent(v.id)}/sas.start`, 'POST'))}>Compare emoji</button>}
              {v.sas?.emojis && (
                <>
                  <p className="emojis">{v.sas.emojis}</p>
                  <p className="muted">Do these match the emoji in your Beeper app?</p>
                </>
              )}
              {actions.has('sas.confirm') && <button className="primary wide" disabled={busy} onClick={() => run(() => api(`link/verify/${encodeURIComponent(v.id)}/sas.confirm`, 'POST'))}>They match</button>}
              {actions.has('cancel') && <button className="danger wide" disabled={busy} onClick={() => run(() => api(`link/verify/${encodeURIComponent(v.id)}/cancel`, 'POST'))}>{v.sas?.emojis ? "They don't match" : 'Cancel'}</button>}
              {v.error && <p className="error">{v.error.reason}</p>}
            </div>
          )}
          <button className="link" onClick={() => setShowRecovery(!showRecovery)}>Use my recovery code instead</button>
          {(showRecovery || state === 'needs-secrets') && (
            <form onSubmit={e => { e.preventDefault(); run(() => api('link/recovery-key', 'POST', { recoveryKey: recovery })) }}>
              <input type="password" placeholder="Recovery code" value={recovery} onChange={e => setRecovery(e.target.value)} />
              <button className="primary" disabled={busy || !recovery}>Verify with recovery code</button>
            </form>
          )}
        </div>
      )}
      {state === 'ready' && <p className="muted">Beeper is linked and verified{st?.matrix?.userID ? ` (${st.matrix.userID})` : ''}.</p>}
      <ErrorNote error={error} />
    </Card>
  )
}

interface Bridge { id: string; displayName: string; provider: string; status: string; activeAccountCount: number; network?: string; accounts: Array<{ accountID: string; status: string; user?: { fullName?: string; phoneNumber?: string; username?: string } }> }
interface Field { id: string; label?: string; placeholder?: string; type?: string; initialValue?: string; name?: string }
interface Step { type: string; stepID?: string; instructions?: string; fields?: Field[]; url?: string; display?: { type: string; data?: string; imageURL?: string } }
interface LoginSession { loginSessionID: string; bridgeID: string; status: string; currentStep?: Step; error?: { message?: string }; waiting?: boolean }

function Networks() {
  const [bridges, setBridges] = useState<Bridge[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<LoginSession | null>(null)
  const [flows, setFlows] = useState<{ bridgeID: string; items: Array<{ id: string; name?: string; description?: string }> } | null>(null)

  const load = useCallback(() => api<{ bridges: { items: Bridge[] } }>('bridges').then(d => setBridges(d.bridges.items)).catch(e => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!session || ['complete', 'cancelled', 'failed'].includes(session.status)) return
    const t = setInterval(() => {
      api<{ session: LoginSession }>(`bridges/${encodeURIComponent(session.bridgeID)}/login/${encodeURIComponent(session.loginSessionID)}`)
        .then(d => setSession(d.session))
        .catch(() => undefined)
    }, 3_000)
    return () => clearInterval(t)
  }, [session])

  useEffect(() => { if (session?.status === 'complete') load() }, [session?.status, load])

  async function connect(bridgeID: string, flowID?: string) {
    setError(null)
    try {
      if (!flowID) {
        const f = await api<{ flows: { items: Array<{ id: string; name?: string; description?: string }> } }>(`bridges/${encodeURIComponent(bridgeID)}/flows`)
        if (f.flows.items.length > 1) {
          setFlows({ bridgeID, items: f.flows.items })
          return
        }
        flowID = f.flows.items[0]?.id
      }
      setFlows(null)
      const d = await api<{ session: LoginSession }>(`bridges/${encodeURIComponent(bridgeID)}/login`, 'POST', { flowID })
      setSession({ ...d.session, bridgeID })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const sorted = (bridges ?? []).slice().sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName))
  return (
    <Card title="2 · Chat apps" right={<button className="link" onClick={load}>Refresh</button>}>
      <p className="muted small">Connect WhatsApp, Telegram and others on this server. Use the ones marked “on this server” for chats that live on your phone.</p>
      <ErrorNote error={error} />
      {flows && (
        <div className="flows">
          <p>Choose how to sign in:</p>
          {flows.items.map(f => <button key={f.id} className="secondary wide" onClick={() => connect(flows.bridgeID, f.id)}>{f.name ?? f.id}{f.description ? ` · ${f.description}` : ''}</button>)}
          <button className="link" onClick={() => setFlows(null)}>Cancel</button>
        </div>
      )}
      {session && <LoginStepView session={session} onUpdate={s => setSession({ ...s, bridgeID: session.bridgeID })} onClose={() => setSession(null)} />}
      <ul className="bridges">
        {sorted.map(b => (
          <li key={b.id}>
            <div>
              <strong>{b.displayName}</strong>
              <small>{b.provider === 'local' ? 'on this server' : b.provider === 'cloud' ? 'Beeper Cloud' : b.provider}{b.activeAccountCount ? ` · ${b.activeAccountCount} connected` : ''}</small>
              {b.accounts.map(a => <small key={a.accountID} className={a.status === 'connected' ? 'ok' : 'bad'}>{a.user?.fullName || a.user?.phoneNumber || a.user?.username || a.accountID}: {a.status}</small>)}
            </div>
            {b.status !== 'disabled' && b.status !== 'temporarily_unavailable' && (b.activeAccountCount === 0 || b.status !== 'limit_reached') && (
              <button className="secondary" onClick={() => connect(b.id)}>{b.activeAccountCount ? 'Add' : 'Connect'}</button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function rank(b: Bridge): number {
  const net = `${b.id} ${b.network ?? ''}`.toLowerCase()
  if (net.includes('whatsapp')) return 0
  if (net.includes('telegram')) return 1
  return b.provider === 'local' ? 2 : 3
}

function LoginStepView({ session, onUpdate, onClose }: { session: LoginSession; onUpdate: (s: LoginSession) => void; onClose: () => void }) {
  const step = session.currentStep
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrImage, setQrImage] = useState<{ data: string; url: string } | null>(null)
  const qrData = step?.type === 'display_and_wait' && step.display?.type === 'qr' ? step.display.data ?? null : null
  const qr = qrData && qrImage?.data === qrData ? qrImage.url : null

  useEffect(() => {
    if (!qrData) return
    let alive = true
    QRCode.toDataURL(qrData, { margin: 1, width: 260 }).then(url => { if (alive) setQrImage({ data: qrData, url }) }).catch(() => undefined)
    return () => { alive = false }
  }, [qrData])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!step?.stepID) return
    setBusy(true)
    setError(null)
    try {
      const fields: Record<string, string> = {}
      for (const f of step.fields ?? []) fields[f.id] = values[f.id] ?? f.initialValue ?? ''
      const d = await api<{ session: LoginSession }>(`bridges/${encodeURIComponent(session.bridgeID)}/login/${encodeURIComponent(session.loginSessionID)}/steps/${encodeURIComponent(step.stepID)}`, 'POST', { type: step.type, fields })
      setValues({})
      onUpdate(d.session)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    await api(`bridges/${encodeURIComponent(session.bridgeID)}/login/${encodeURIComponent(session.loginSessionID)}`, 'DELETE').catch(() => undefined)
    onClose()
  }

  const done = ['complete', 'cancelled', 'failed'].includes(session.status)
  return (
    <div className="login-step">
      {step?.instructions && <p>{step.instructions}</p>}
      {step?.type === 'user_input' && (
        <form onSubmit={submit}>
          {step.fields?.map(f => (
            <label key={f.id} className="field">
              <span>{f.label ?? f.id}</span>
              <input type={f.type === 'password' ? 'password' : f.type === 'phone_number' ? 'tel' : 'text'} placeholder={f.placeholder} defaultValue={f.initialValue} onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))} />
            </label>
          ))}
          <button className="primary" disabled={busy}>Continue</button>
        </form>
      )}
      {step?.type === 'display_and_wait' && (
        <div className="center">
          {step.display?.type === 'code' && <p className="pair-code">{step.display.data}</p>}
          {qr && <img src={qr} alt="QR code" width={260} height={260} />}
          {step.display?.type === 'emoji' && step.display.imageURL && <img src={step.display.imageURL} alt="emoji" width={120} />}
          <p className="muted small">{session.waiting ? 'Waiting for you to finish on your phone…' : 'Checking…'}</p>
        </div>
      )}
      {step?.type === 'cookies' && (
        <form onSubmit={submit}>
          <p className="muted small">This app signs in with browser cookies from <a href={step.url} target="_blank" rel="noreferrer">{step.url}</a>. That is hard on an iPhone; paste the values only if you know how to get them.</p>
          {step.fields?.map(f => (
            <label key={f.id} className="field"><span>{f.name ?? f.id}</span><input type="password" onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))} /></label>
          ))}
          <button className="primary" disabled={busy}>Continue</button>
        </form>
      )}
      {session.status === 'complete' && <p className="ok">Connected! Your chats will appear in the Chats tab in a minute.</p>}
      {session.status === 'failed' && <p className="error">Sign-in failed{session.error?.message ? `: ${session.error.message}` : ''}</p>}
      {session.error?.message && session.status !== 'failed' && <p className="error">{session.error.message}</p>}
      <ErrorNote error={error} />
      <button className="link" onClick={done ? onClose : cancel}>{done ? 'Close' : 'Cancel sign-in'}</button>
    </div>
  )
}
