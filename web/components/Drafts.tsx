'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, timeAgo, type Draft } from '@/lib/client'
import { Card, ErrorNote } from './ui'

export function Drafts() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => api<{ drafts: Draft[] }>(`drafts${showAll ? '?all=1' : ''}`).then(d => setDrafts(d.drafts)).catch(e => setError(e.message)), [showAll])
  useEffect(() => {
    load()
    const t = setInterval(load, 8_000)
    return () => clearInterval(t)
  }, [load])

  return (
    <>
      <div className="toolbar">
        <h1>Approvals</h1>
        <button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Pending only' : 'History'}</button>
      </div>
      <ErrorNote error={error} />
      {drafts?.length === 0 && <Card><p className="muted">Nothing waiting. New drafts show up here and in your Beeper “Note to self” chat.</p></Card>}
      {drafts?.map(d => <DraftCard key={`${d.id}-${d.createdAt}`} draft={d} onChange={load} />)}
    </>
  )
}

function DraftCard({ draft, onChange }: { draft: Draft; onChange: () => void }) {
  const [text, setText] = useState(draft.text)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = draft.status === 'pending'

  async function act(action: 'send' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      await api(`drafts/${draft.id}/${action}`, 'POST', action === 'send' ? { text } : {})
      onChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={draft.chatTitle} right={<span className={`pill ${draft.status}`}>{draft.status}</span>}>
      <p className="muted small">{draft.network} · {timeAgo(draft.createdAt)}{draft.reason ? ` · ${draft.reason}` : ''}</p>
      <blockquote>{draft.incomingText}</blockquote>
      {pending ? <textarea value={text} rows={3} onChange={e => setText(e.target.value)} /> : <p className="reply">{draft.text}</p>}
      {draft.error && <p className="error">{draft.error}</p>}
      {pending && (
        <div className="actions">
          <button className="danger" disabled={busy} onClick={() => act('reject')}>Reject</button>
          <button className="primary" disabled={busy || !text.trim()} onClick={() => act('send')}>{text === draft.text ? 'Send' : 'Send edited'}</button>
        </div>
      )}
      <ErrorNote error={error} />
    </Card>
  )
}
