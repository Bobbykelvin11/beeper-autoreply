'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, type Mode, type Settings } from '@/lib/client'
import { Card, ErrorNote, ModePicker, Row, Toggle } from './ui'

interface Status {
  enabled: boolean
  defaultMode: Mode
  signedIn: boolean
  events: string
  pendingDrafts: number
  allowedChats: number
  noteToSelfChatID: string
  provider: { baseURL: string; model: string; hasKey: boolean }
  version: string
}

export function Home({ go }: { go: (tab: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => api<Status>('status').then(setStatus).catch(e => setError(e.message)), [])
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  async function patch(p: Partial<Settings>) {
    setError(null)
    try {
      await api('settings', 'PUT', p)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!status) return <Card><p className="muted">{error ?? 'Loading…'}</p></Card>
  const ready = status.signedIn && status.events === 'connected'
  return (
    <>
      <Card>
        <Row label="Auto-reply bot" hint={status.enabled ? 'On: replying to chats you allowed' : 'Off: nothing will be drafted or sent'}>
          <Toggle checked={status.enabled} onChange={v => patch({ enabled: v })} label="Bot on/off" />
        </Row>
        <Row label="Default mode" hint={status.defaultMode === 'approve' ? 'You approve every reply first' : 'Replies send automatically after a short delay'}>
          <ModePicker value={status.defaultMode} options={[['approve', 'Approve'], ['auto', 'Automatic']]} onChange={v => patch({ defaultMode: v })} />
        </Row>
        <ErrorNote error={error} />
      </Card>
      <Card title="Status">
        <ul className="status">
          <li className={status.signedIn ? 'ok' : 'bad'}>Beeper: {status.signedIn ? 'signed in' : 'not linked yet'}{!status.signedIn && <button className="link" onClick={() => go('link')}>Link now</button>}</li>
          <li className={status.events === 'connected' ? 'ok' : 'bad'}>Live messages: {status.events}</li>
          <li className={status.allowedChats ? 'ok' : 'bad'}>Allowed chats: {status.allowedChats}{!status.allowedChats && <button className="link" onClick={() => go('chats')}>Choose chats</button>}</li>
          <li className={status.provider.baseURL ? 'ok' : 'bad'}>AI: {status.provider.model} <span className="muted">({hostOf(status.provider.baseURL)})</span></li>
          <li className={status.noteToSelfChatID ? 'ok' : 'warn'}>Note to self approvals: {status.noteToSelfChatID ? 'ready' : 'chat not found yet'}</li>
        </ul>
        {status.pendingDrafts > 0 && <button className="primary wide" onClick={() => go('drafts')}>{status.pendingDrafts} reply{status.pendingDrafts > 1 ? 'ies' : ''} waiting for you</button>}
        {!ready && <p className="muted small">Finish the steps in the Link tab first.</p>}
      </Card>
      <p className="muted small center">Server v{status.version}</p>
    </>
  )
}

function hostOf(u: string): string {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}
